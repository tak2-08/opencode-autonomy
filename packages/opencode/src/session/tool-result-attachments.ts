import type { SessionV1 } from "@opencode-ai/core/v1/session"

// Executed tools return attachment descriptors, not persisted message parts.
// Validate the descriptor before assigning the IDs required by FilePart.
type Descriptor = Pick<SessionV1.FilePart, "type" | "mime" | "url" | "filename">

const isDescriptor = (value: unknown): value is Descriptor => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const file = value as Record<string, unknown>
  return (
    file.type === "file" &&
    typeof file.mime === "string" && file.mime.length > 0 &&
    typeof file.url === "string" && file.url.length > 0 &&
    (file.filename === undefined || typeof file.filename === "string")
  )
}

export function normalizeToolResultAttachments(
  input: unknown,
  target: {
    sessionID: SessionV1.FilePart["sessionID"]
    messageID: SessionV1.FilePart["messageID"]
    nextID: () => SessionV1.FilePart["id"]
  },
): SessionV1.FilePart[] | undefined {
  if (!Array.isArray(input)) return undefined
  const files = input.filter(isDescriptor).map((file) => ({
    type: file.type,
    mime: file.mime,
    url: file.url,
    ...(file.filename === undefined ? {} : { filename: file.filename }),
    id: target.nextID(),
    sessionID: target.sessionID,
    messageID: target.messageID,
  }))
  return files.length ? files : undefined
}
