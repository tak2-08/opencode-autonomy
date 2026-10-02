import { base64Encode } from "@opencode-ai/core/util/encode"

export type ApprovalMode = "manual" | "acceptEdits" | "auto" | "autoAccept"
export const APPROVAL_MODE_PERMISSION = "__opencode_approval_mode__"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function scopedValue(values: Record<string, boolean>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  return values[key] ?? values[sessionID]
}

function modeFromValues(
  autoAccept: boolean | undefined,
  autoJudge: boolean | undefined,
  acceptEdits: boolean | undefined,
): ApprovalMode | undefined {
  if (autoAccept === true) return "autoAccept"
  if (autoJudge === true) return "auto"
  if (acceptEdits === true) return "acceptEdits"
  if (autoAccept === false || autoJudge === false || acceptEdits === false) return "manual"
}
function scopedMode(
  autoAccept: Record<string, boolean>,
  autoJudge: Record<string, boolean>,
  acceptEdits: Record<string, boolean>,
  sessionID: string,
  directory?: string,
) {
  return modeFromValues(
    scopedValue(autoAccept, sessionID, directory),
    scopedValue(autoJudge, sessionID, directory),
    scopedValue(acceptEdits, sessionID, directory),
  )
}

export function directoryApprovalMode(
  autoAccept: Record<string, boolean>,
  autoJudge: Record<string, boolean>,
  acceptEdits: Record<string, boolean>,
  directory: string,
): ApprovalMode {
  const key = directoryAcceptKey(directory)
  return modeFromValues(autoAccept[key], autoJudge[key], acceptEdits[key]) ?? "manual"
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]
  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }
  return ids
}

export function storedSessionApprovalMode(
  session: {
    id: string
    parentID?: string
    permission?: { permission: string; pattern: string }[]
  }[],
  sessionID: string,
): ApprovalMode | undefined {
  for (const id of sessionLineage(session, sessionID)) {
    const info = session.find((item) => item.id === id)
    const rule = [...(info?.permission ?? [])].reverse().find((item) => item.permission === APPROVAL_MODE_PERMISSION)
    if (
      rule?.pattern === "manual" ||
      rule?.pattern === "acceptEdits" ||
      rule?.pattern === "auto" ||
      rule?.pattern === "autoAccept"
    ) {
      return rule.pattern
    }
  }
  return undefined
}

export function sessionApprovalMode(
  autoAccept: Record<string, boolean>,
  autoJudge: Record<string, boolean>,
  acceptEdits: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
): ApprovalMode | undefined {
  return sessionLineage(session, permission.sessionID)
    .map((id) => scopedMode(autoAccept, autoJudge, acceptEdits, id, directory))
    .find((item): item is ApprovalMode => item !== undefined)
}

export function approvalModeResponds(mode: ApprovalMode, permission?: string) {
  if (permission?.startsWith("sftp_")) return false
  if (mode === "autoAccept") return true
  return mode === "acceptEdits" && permission === "edit"
}

export function approvalModeForPermission(
  autoAccept: Record<string, boolean>,
  autoJudge: Record<string, boolean>,
  acceptEdits: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
): ApprovalMode {
  const override = sessionApprovalMode(autoAccept, autoJudge, acceptEdits, session, permission, directory)
  if (override !== undefined) return override
  return directory ? directoryApprovalMode(autoAccept, autoJudge, acceptEdits, directory) : "manual"
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string; permission?: string },
  directory?: string,
  acceptEdits: Record<string, boolean> = {},
  autoJudge: Record<string, boolean> = {},
) {
  return approvalModeResponds(
    approvalModeForPermission(autoAccept, autoJudge, acceptEdits, session, permission, directory),
    permission.permission,
  )
}

export function sessionAutoAccept(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return sessionLineage(session, permission.sessionID)
    .map((id) => scopedValue(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
}
