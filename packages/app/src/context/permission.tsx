import { createEffect, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { Persist, persisted } from "@/utils/persist"
import type { ServerSDK } from "@/context/server-sdk"
import type { ServerSync } from "./server-sync"
import { useParams, useSearchParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { type DraftTab, useTabs } from "./tabs"
import { useSettings } from "./settings"
import { requireServerKey } from "@/utils/session-route"
import type { ServerScope } from "@/utils/server-scope"
import { normalizePermissionRequest } from "./global-sync/utils"
import {
  type ApprovalMode,
  APPROVAL_MODE_PERMISSION,
  acceptKey,
  directoryAcceptKey,
  directoryApprovalMode,
  approvalModeResponds,
  sessionApprovalMode,
  storedSessionApprovalMode,
} from "./permission-auto-respond"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; dir?: string; id?: string }>()
    const [search] = useSearchParams<{ draftId?: string }>()
    const global = useGlobal()
    const server = useServer()
    const tabs = useTabs()
    const settings = useSettings()
    const owner = getOwner()
    const states = new Map<ServerScope, { key: ServerConnection.Key; dispose: () => void; state: PermissionState }>()

    const activeDraft = createMemo(() => {
      if (!search.draftId) return
      return tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
    })

    const activeServer = createMemo(() => {
      if (params.serverKey && settings.general.newLayoutDesigns()) return requireServerKey(params.serverKey)
      return activeDraft()?.server ?? server.key
    })

    const ensure = (key: ServerConnection.Key) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === key)
      if (!conn) throw new Error(`Permission server not found: ${key}`)
      const ctx = global.ensureServerCtx(conn)
      const existing = states.get(ctx.sdk.scope)
      if (existing && global.servers.list().some((item) => ServerConnection.key(item) === existing.key)) {
        return existing.state
      }
      if (existing) {
        existing.dispose()
        states.delete(ctx.sdk.scope)
      }
      const root = createRoot(
        (dispose) => ({
          key,
          dispose,
          state: createServerPermissionState({ sdk: ctx.sdk, sync: ctx.sync }),
        }),
        owner ?? undefined,
      )
      states.set(ctx.sdk.scope, root)
      return root.state
    }

    createEffect(() => {
      global.servers.list().forEach((conn) => ensure(ServerConnection.key(conn)))
    })

    createEffect(() => {
      const list = global.servers.list()
      const keys = new Set(list.map(ServerConnection.key))
      states.forEach((value, scope) => {
        if (keys.has(value.key)) return
        value.dispose()
        states.delete(scope)
        const replacement = list.find((conn) => server.scope(ServerConnection.key(conn)) === scope)
        if (replacement) ensure(ServerConnection.key(replacement))
      })
    })

    onCleanup(() => states.forEach((value) => value.dispose()))

    let lastSelected: PermissionState | undefined
    const selected = () => {
      const key = activeServer()
      if (global.servers.list().some((conn) => ServerConnection.key(conn) === key)) {
        lastSelected = ensure(key)
      }
      if (lastSelected) return lastSelected
      return ensure(server.key)
    }
    const activeDirectory = createMemo(() => {
      const directory = decode64(params.dir)
      if (directory) return directory
      const draft = activeDraft()
      if (draft) return draft.directory
      if (!params.id) return
      if (!global.servers.list().some((conn) => ServerConnection.key(conn) === activeServer())) return
      return selected().sync.session.lineage.peek(params.id)?.session.directory
    })

    createEffect(() => {
      const directory = activeDirectory()
      if (!directory) return
      selected().enableConfiguredDirectory(directory)
    })

    const permissionsEnabled = createMemo(() => {
      const directory = activeDirectory()
      if (!directory) return false
      return selected().permissionsEnabled(directory)
    })

    return {
      ready: () => selected().ready(),
      ensureServerState: (key: ServerConnection.Key) => ensure(key).api,
      currentServerState: () => selected().api,
      respond(input: Parameters<PermissionRespondFn>[0]) {
        selected().respond(input)
      },
      autoResponds(permission: PermissionRequest, directory?: string) {
        return selected().autoResponds(permission, directory)
      },
      isAutoAccepting(sessionID: string, directory?: string) {
        return selected().isAutoAccepting(sessionID, directory)
      },
      isAutoAcceptingDirectory(directory: string) {
        return selected().isAutoAcceptingDirectory(directory)
      },
      approvalMode(sessionID: string | undefined, directory: string) {
        return selected().approvalMode(sessionID, directory)
      },
      setApprovalMode(mode: ApprovalMode, sessionID: string | undefined, directory: string) {
        return selected().setApprovalMode(mode, sessionID, directory)
      },
      toggleAutoAccept(sessionID: string, directory: string) {
        selected().toggleAutoAccept(sessionID, directory)
      },
      toggleAutoAcceptDirectory(directory: string) {
        selected().toggleAutoAcceptDirectory(directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        selected().enableAutoAccept(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        selected().disableAutoAccept(sessionID, directory)
      },
      permissionsEnabled,
      isPermissionAllowAll(directory: string) {
        return selected().isPermissionAllowAll(directory)
      },
    }
  },
})

type PermissionState = ReturnType<typeof createServerPermissionState>
type PermissionEvent = Parameters<Parameters<ServerSDK["event"]["listen"]>[0]>[0]

function createServerPermissionState(input: { sdk: ServerSDK; sync: ServerSync }) {
  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.serverGlobal(input.sdk.scope, "permission", ["permission.v3"]),
      migrate(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value

        const data = value as Record<string, unknown>
        const autoAccept =
          typeof data.autoAccept === "object" && data.autoAccept && !Array.isArray(data.autoAccept)
            ? data.autoAccept
            : typeof data.autoAcceptEdits === "object" && data.autoAcceptEdits && !Array.isArray(data.autoAcceptEdits)
              ? data.autoAcceptEdits
              : {}
        const acceptEdits =
          typeof data.acceptEdits === "object" && data.acceptEdits && !Array.isArray(data.acceptEdits)
            ? data.acceptEdits
            : {}
        const autoJudge =
          typeof data.autoJudge === "object" && data.autoJudge && !Array.isArray(data.autoJudge) ? data.autoJudge : {}

        return {
          ...data,
          autoAccept,
          acceptEdits,
          autoJudge,
        }
      },
    },
    createStore({
      autoAccept: {} as Record<string, boolean>,
      acceptEdits: {} as Record<string, boolean>,
      autoJudge: {} as Record<string, boolean>,
    }),
  )

  function enableConfiguredDirectory(directory: string) {
    if (input.sdk.protocolKind() !== "v1") return
    if (meta.disposed || !ready()) return
    const [childStore] = input.sync.child(directory)
    if (childStore.config.permission !== "allow") return
    const key = directoryAcceptKey(directory)
    if (store.autoAccept[key] !== undefined) return
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
        draft.acceptEdits[key] = false
        draft.autoJudge[key] = false
      }),
    )
  }

  const MAX_RESPONDED = 1000
  const RESPONDED_TTL_MS = 60 * 60 * 1000
  const responded = new Map<string, number>()
  const enableVersion = new Map<string, number>()
  const hydratedMode = new Set<string>()
  const meta = { disposed: false }

  function pruneResponded(now: number) {
    for (const [id, ts] of responded) {
      if (now - ts < RESPONDED_TTL_MS) break
      responded.delete(id)
    }

    for (const id of responded.keys()) {
      if (responded.size <= MAX_RESPONDED) break
      responded.delete(id)
    }
  }

  const respond: PermissionRespondFn = (request) => {
    if (meta.disposed) return
    input.sdk.api.permission
      .reply({
        sessionID: request.sessionID,
        requestID: request.permissionID,
        reply: request.response,
        location: request.directory ? { directory: request.directory } : undefined,
      })
      .catch(() => {
        responded.delete(request.permissionID)
      })
  }

  const list = async (directory: string) => {
    if ((await input.sdk.protocol) === "v1") {
      return (await input.sdk.client.permission.list({ directory })).data ?? []
    }
    return input.sdk.api.permission.request
      .list({ location: { directory } })
      .then((result) => result.data.map(normalizePermissionRequest))
  }

  function respondOnce(permission: PermissionRequest, directory?: string) {
    const now = Date.now()
    const hit = responded.has(permission.id)
    responded.delete(permission.id)
    responded.set(permission.id, now)
    pruneResponded(now)
    if (hit) return
    respond({
      sessionID: permission.sessionID,
      permissionID: permission.id,
      response: "once",
      directory,
    })
  }

  function sessions(directory?: string) {
    const info = Object.values(input.sync.session.data.info).filter((session) => !!session)
    if (!directory) return info
    return [...info, ...input.sync.child(directory, { bootstrap: false })[0].session]
  }

  function hydrateSessionMode(sessionID: string, directory: string) {
    const key = acceptKey(sessionID, directory)
    if (hydratedMode.has(key)) return
    hydratedMode.add(key)

    void (async () => {
      const lineage = []
      const seen = new Set<string>()
      let current: string | undefined = sessionID
      while (current && !seen.has(current) && lineage.length < 16) {
        seen.add(current)
        const info: Session | undefined = await input.sdk.client.session
          .get({ sessionID: current, directory })
          .then((result) => result.data)
        if (!info) break
        lineage.push(info)
        current = info.parentID
      }
      if (meta.disposed) return
      const mode = storedSessionApprovalMode(lineage, sessionID)
      if (mode) setModeKey(key, mode)
    })().catch(() => hydratedMode.delete(key))
  }

  function approvalMode(sessionID: string | undefined, directory: string) {
    if (!sessionID) return directoryApprovalMode(store.autoAccept, store.autoJudge, store.acceptEdits, directory)
    hydrateSessionMode(sessionID, directory)
    const override = sessionApprovalMode(
      store.autoAccept,
      store.autoJudge,
      store.acceptEdits,
      sessions(directory),
      { sessionID },
      directory,
    )
    return override ?? directoryApprovalMode(store.autoAccept, store.autoJudge, store.acceptEdits, directory)
  }

  function isAutoAccepting(sessionID: string, directory?: string) {
    if (!directory) {
      const override = sessionApprovalMode(store.autoAccept, store.autoJudge, store.acceptEdits, sessions(), {
        sessionID,
      })
      return override === "autoAccept"
    }
    return approvalMode(sessionID, directory) === "autoAccept"
  }

  function isAutoAcceptingDirectory(directory: string) {
    return directoryApprovalMode(store.autoAccept, store.autoJudge, store.acceptEdits, directory) === "autoAccept"
  }

  function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
    const list = sessions(directory)
    const override = sessionApprovalMode(
      store.autoAccept,
      store.autoJudge,
      store.acceptEdits,
      list,
      permission,
      directory,
    )
    if (override !== undefined) return approvalModeResponds(override, permission.permission)
    const fallback = directory
      ? directoryApprovalMode(store.autoAccept, store.autoJudge, store.acceptEdits, directory)
      : "manual"
    return approvalModeResponds(fallback, permission.permission)
  }

  function isPending(permission: PermissionRequest) {
    const pending = input.sync.session.data.permission[permission.sessionID]
    return pending === undefined || pending.some((item) => item.id === permission.id)
  }

  async function shouldAutoRespondResolved(permission: PermissionRequest, directory?: string) {
    const override = sessionApprovalMode(
      store.autoAccept,
      store.autoJudge,
      store.acceptEdits,
      sessions(directory),
      permission,
      directory,
    )
    if (override !== undefined) return approvalModeResponds(override, permission.permission)
    if (input.sync.session.lineage.peek(permission.sessionID)) return shouldAutoRespond(permission, directory)
    const lineage = await input.sync.session.lineage.resolve(permission.sessionID).catch(() => undefined)
    if (meta.disposed || !lineage) return false
    return shouldAutoRespond(permission, directory)
  }

  async function respondPending(
    permission: PermissionRequest,
    directory?: string,
    current: () => boolean = () => true,
  ) {
    // UI 자동 승인 루프에서도 별도로 금지해 설정·서브세션 변경으로 우회하지 못하게 한다.
    if (permission.permission.startsWith("sftp_")) return
    if (!current() || !isPending(permission)) return
    if (!(await shouldAutoRespondResolved(permission, directory))) return
    if (meta.disposed || !current() || !isPending(permission)) return
    respondOnce(permission, directory)
  }

  function bumpEnableVersion(sessionID: string, directory?: string) {
    const key = acceptKey(sessionID, directory)
    const next = (enableVersion.get(key) ?? 0) + 1
    enableVersion.set(key, next)
    return next
  }

  const handlePermission = (e: PermissionEvent) => {
    const event = e.details
    if (event?.type !== "permission.asked") return
    void respondPending(event.properties, e.name)
  }

  const unsubscribe = input.sdk.event.listen((event) => {
    if (ready()) {
      handlePermission(event)
      return
    }
    void ready.promise?.then(() => {
      if (meta.disposed) return
      handlePermission(event)
    })
  })
  onCleanup(() => {
    meta.disposed = true
    unsubscribe()
  })

  async function persistSessionMode(sessionID: string, directory: string, mode: ApprovalMode) {
    try {
      await input.sdk.client.session.update({
        sessionID,
        directory,
        permission: [{ permission: APPROVAL_MODE_PERMISSION, pattern: mode, action: "allow" }],
      })
      return true
    } catch {
      return false
    }
  }

  function setModeKey(key: string, mode: ApprovalMode) {
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = mode === "autoAccept"
        draft.autoJudge[key] = mode === "auto"
        draft.acceptEdits[key] = mode === "acceptEdits"
      }),
    )
  }

  function setDirectoryMode(directory: string, mode: ApprovalMode) {
    if (meta.disposed) return
    const key = directoryAcceptKey(directory)
    setModeKey(key, mode)
    if (mode === "manual" || mode === "auto") return Promise.resolve(true)

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (approvalMode(undefined, directory) !== mode) return
        for (const permission of permissions) {
          void respondPending(permission, directory, () => approvalMode(undefined, directory) === mode)
        }
      })
      .catch(() => undefined)
  }

  function setSessionMode(sessionID: string, directory: string, mode: ApprovalMode) {
    if (meta.disposed) return
    const key = acceptKey(sessionID, directory)
    const version = bumpEnableVersion(sessionID, directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = mode === "autoAccept"
        draft.autoJudge[key] = mode === "auto"
        draft.acceptEdits[key] = mode === "acceptEdits"
        delete draft.autoAccept[sessionID]
        delete draft.autoJudge[sessionID]
        delete draft.acceptEdits[sessionID]
      }),
    )
    const persisted = persistSessionMode(sessionID, directory, mode)
    if (mode === "manual" || mode === "auto") return persisted

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (enableVersion.get(key) !== version) return
        if (approvalMode(sessionID, directory) !== mode) return
        for (const permission of permissions) {
          void respondPending(
            permission,
            directory,
            () => enableVersion.get(key) === version && approvalMode(sessionID, directory) === mode,
          )
        }
      })
      .catch(() => undefined)
    return persisted
  }

  function enableDirectory(directory: string) {
    setDirectoryMode(directory, "autoAccept")
  }

  function disableDirectory(directory: string) {
    setDirectoryMode(directory, "manual")
  }

  function enable(sessionID: string, directory: string) {
    setSessionMode(sessionID, directory, "autoAccept")
  }

  function disable(sessionID: string, directory?: string) {
    if (meta.disposed) return
    if (directory) {
      setSessionMode(sessionID, directory, "manual")
      return
    }

    bumpEnableVersion(sessionID)
    setStore(
      produce((draft) => {
        draft.autoAccept[sessionID] = false
        draft.autoJudge[sessionID] = false
        draft.acceptEdits[sessionID] = false
      }),
    )
  }

  const api = {
    ready: () => !meta.disposed && ready(),
    respond,
    autoResponds(permission: PermissionRequest, directory?: string) {
      if (meta.disposed) return false
      return shouldAutoRespond(permission, directory)
    },
    isAutoAccepting(sessionID: string, directory?: string) {
      if (meta.disposed) return false
      return isAutoAccepting(sessionID, directory)
    },
    isAutoAcceptingDirectory(directory: string) {
      if (meta.disposed) return false
      return isAutoAcceptingDirectory(directory)
    },
    approvalMode(sessionID: string | undefined, directory: string) {
      if (meta.disposed) return "manual" as ApprovalMode
      return approvalMode(sessionID, directory)
    },
    setApprovalMode(mode: ApprovalMode, sessionID: string | undefined, directory: string) {
      if (meta.disposed) return
      if (sessionID) return setSessionMode(sessionID, directory, mode)
      setDirectoryMode(directory, mode)
      return Promise.resolve(true)
    },
    toggleAutoAccept(sessionID: string, directory: string) {
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) {
        disable(sessionID, directory)
        return
      }

      enable(sessionID, directory)
    },
    toggleAutoAcceptDirectory(directory: string) {
      if (meta.disposed) return
      if (isAutoAcceptingDirectory(directory)) {
        disableDirectory(directory)
        return
      }
      enableDirectory(directory)
    },
    enableAutoAccept(sessionID: string, directory: string) {
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) return
      enable(sessionID, directory)
    },
    disableAutoAccept(sessionID: string, directory?: string) {
      if (meta.disposed) return
      disable(sessionID, directory)
    },
    isPermissionAllowAll(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return childStore.config.permission === "allow"
    },
  }

  return {
    ...api,
    api,
    sync: input.sync,
    enableConfiguredDirectory,
    permissionsEnabled(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return hasPermissionPromptRules(childStore.config.permission)
    },
  }
}
