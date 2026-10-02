import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionV1 } from "@opencode-ai/core/v1/session"

export type ApprovalMode = "manual" | "acceptEdits" | "auto" | "autoAccept"
export type AutoDecision = "allow" | "ask" | "deny"

export const APPROVAL_MODE_PERMISSION = "__opencode_approval_mode__"

const modes = new Set<ApprovalMode>(["manual", "acceptEdits", "auto", "autoAccept"])

export function approvalModeFromRules(ruleset: PermissionV1.Ruleset | undefined): ApprovalMode {
  const marker = [...(ruleset ?? [])]
    .reverse()
    .find((rule) => rule.permission === APPROVAL_MODE_PERMISSION && modes.has(rule.pattern as ApprovalMode))
  return (marker?.pattern as ApprovalMode | undefined) ?? "manual"
}

export function approvalModeRule(mode: ApprovalMode): PermissionV1.Rule {
  return { permission: APPROVAL_MODE_PERMISSION, pattern: mode, action: "allow" }
}

export function parseAutoDecision(text: string): AutoDecision {
  const tokens = text.toUpperCase().match(/\b(ALLOW|ASK|DENY)\b/g) ?? []
  const unique = [...new Set(tokens)]
  if (unique.length !== 1) return "ask"
  if (unique[0] === "ALLOW") return "allow"
  if (unique[0] === "DENY") return "deny"
  return "ask"
}
function messageText(message: SessionV1.WithParts) {
  const parts = message.parts.flatMap((part) => {
    if (part.type === "text") return [part.text]
    if (part.type !== "tool") return []
    const state = part.state
    const input = "input" in state ? JSON.stringify(state.input) : ""
    return [`[tool ${part.tool} ${state.status}] ${input}`]
  })
  if (parts.length === 0) return ""
  return `${message.info.role}: ${parts.join("\n")}`
}

export function recentPermissionContext(messages: SessionV1.WithParts[], maxChars = 12000) {
  const chunks: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageText(messages[i]!)
    if (!text) continue
    const remaining = maxChars - used
    if (remaining <= 0) break
    const chunk = text.length > remaining ? text.slice(text.length - remaining) : text
    chunks.unshift(chunk)
    used += chunk.length
  }
  return chunks.join("\n\n")
}

export function permissionClassifierPrompt(input: {
  permission: string
  patterns: string[]
  metadata: unknown
  messages: SessionV1.WithParts[]
}) {
  const context = recentPermissionContext(input.messages)
  return [
    "Classify this pending OpenCode permission request.",
    "Return exactly one token: ALLOW, ASK, or DENY.",
    "",
    "RECENT PARENT SESSION CONTEXT:",
    context || "(no textual context)",
    "",
    "PENDING REQUEST:",
    `permission: ${input.permission}`,
    `patterns: ${JSON.stringify(input.patterns)}`,
    `metadata: ${JSON.stringify(input.metadata ?? {})}`,
  ].join("\n")
}
