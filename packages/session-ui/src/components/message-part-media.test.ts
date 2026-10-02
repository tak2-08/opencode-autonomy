import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { toolResultImages } from "./message-part-media"

const image = { type: "file" as const, mime: "image/png", url: "data:image/png;base64,AA==" }
const pdf = { type: "file" as const, mime: "application/pdf", url: "data:application/pdf;base64,AA==" }
const part = (state: unknown) => ({ type: "tool", tool: "read", state }) as ToolPart

describe("tool result images", () => {
  test("shows completed image reads from tool attachments", () => {
    expect(toolResultImages(part({ status: "completed", attachments: [image] }))).toEqual([image])
  })
  test("filters non-images without mutating the source attachments", () => {
    const attachments = [pdf, image]
    expect(toolResultImages(part({ status: "completed", attachments }))).toEqual([image])
    expect(attachments).toEqual([pdf, image])
  })
  test("does not show unfinished or missing tool outputs", () => {
    expect(toolResultImages(part({ status: "running", attachments: [image] }))).toEqual([])
    expect(toolResultImages(part({ status: "completed" }))).toEqual([])
  })
})
