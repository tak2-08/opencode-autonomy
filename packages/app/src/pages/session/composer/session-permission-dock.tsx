import { For, Show, createMemo } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { sftpPermissionPreview } from "./sftp-permission-preview"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const preview = createMemo(() => sftpPermissionPreview({
    permission: props.request.permission,
    patterns: props.request.patterns,
    metadata: props.request.metadata as Record<string, unknown> | undefined,
  }))

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Show when={!preview()}>
              <Button
                variant="secondary"
                size="normal"
                onClick={() => props.onDecide("always")}
                disabled={props.responding}
              >
                {language.t("ui.permission.allowAlways")}
              </Button>
            </Show>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={preview()}>
        {(content) => (
          <div data-slot="permission-row" data-variant="sftp-preview" class="min-h-0">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="sftp-permission-preview" class="min-w-0 flex-1 max-h-72 overflow-auto rounded-md border border-border-weak-base px-3 py-2">
              <div class="text-12-medium text-text-base mb-2">SFTP 작업 승인 미리보기</div>
              <For each={content().lines}>
                {(line) => <div class="text-12-regular text-text-base whitespace-pre-wrap break-all">{line}</div>}
              </For>
              <Show when={content().diffText}>
                {(diff) => (
                  <pre data-slot="sftp-permission-diff" class="mt-3 max-h-48 overflow-auto text-12-regular text-text-base whitespace-pre-wrap break-words">{diff()}</pre>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>

      <Show when={!preview() && props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
