import { describe, expect, test } from "bun:test"
import { normalizeToolResultAttachments } from "./tool-result-attachments"

const image = { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }
const nextID = () => "prt_test" as ReturnType<NonNullable<Parameters<typeof normalizeToolResultAttachments>[1]["nextID"]>>
const target = { sessionID: "ses_test" as never, messageID: "msg_test" as never, nextID }

describe("tool result media persistence", () => {
  test("assigns missing message part IDs to a read-tool image", () => {
    expect(normalizeToolResultAttachments([image], target)).toEqual([
      { ...image, id: "prt_test", sessionID: "ses_test", messageID: "msg_test" },
    ])
    expect(image).not.toHaveProperty("id")
  })
  test("preserves image filenames and multiple returned files", () => {
    const files = normalizeToolResultAttachments([{ ...image, filename: "screenshot.png" }, image], target)
    expect(files?.length).toBe(2)
    expect(files?.[0]?.filename).toBe("screenshot.png")
  })
  test("rejects incomplete, malformed, and non-file attachments", () => {
    expect(normalizeToolResultAttachments([null, {}, { type: "text", mime: "image/png", url: image.url }, {type:"file",url:image.url}, image], target)?.length).toBe(1)
    expect(normalizeToolResultAttachments([{}], target)).toBeUndefined()
    expect(normalizeToolResultAttachments(undefined, target)).toBeUndefined()
  })
})
