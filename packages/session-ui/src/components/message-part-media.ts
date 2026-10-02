import type { ToolPart } from "@opencode-ai/sdk/v2"

// Image data stays on the tool result. The model's synthetic compatibility
// messages must not become user-authored attachments in the session timeline.
export function toolResultImages(part: ToolPart) {
  if (part.state.status !== "completed") return []
  return part.state.attachments?.filter((attachment) => attachment.mime.startsWith("image/")) ?? []
}
