import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import {
  APPROVAL_MODE_PERMISSION,
  approvalModeFromRules,
  approvalModeRule,
  parseAutoDecision,
  recentPermissionContext,
} from "./permission-auto"

describe("approval mode marker", () => {
  test("defaults to manual and uses the latest marker", () => {
    expect(approvalModeFromRules(undefined)).toBe("manual")
    expect(
      approvalModeFromRules([
        approvalModeRule("acceptEdits"),
        { permission: "bash", pattern: "*", action: "ask" },
        approvalModeRule("auto"),
      ]),
    ).toBe("auto")
  })

  test("marker cannot collide with ordinary permission actions", () => {
    expect(approvalModeRule("autoAccept")).toEqual({
      permission: APPROVAL_MODE_PERMISSION,
      pattern: "autoAccept",
      action: "allow",
    })
  })
})
describe("Auto classifier output", () => {
  test("accepts one unambiguous decision token", () => {
    expect(parseAutoDecision("ALLOW")).toBe("allow")
    expect(parseAutoDecision("ask")).toBe("ask")
    expect(parseAutoDecision("DENY")).toBe("deny")
  })

  test("fails closed to ask for malformed or conflicting output", () => {
    expect(parseAutoDecision("I think this is okay")).toBe("ask")
    expect(parseAutoDecision("ALLOW or ASK")).toBe("ask")
  })
})

describe("recent permission context", () => {
  test("includes recent text and respects the cap", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "first" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "second" }] },
    ] as unknown as SessionV1.WithParts[]
    const full = recentPermissionContext(messages)
    expect(full).toContain("user: first")
    expect(full).toContain("assistant: second")
    expect(recentPermissionContext(messages, 8).length).toBeLessThanOrEqual(8)
  })
})
