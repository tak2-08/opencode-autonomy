import { expect, test } from "bun:test"
import type { Agent } from "./agent"
import { deriveSubagentSessionPermission } from "./subagent-permissions"

test("subagents inherit approval-mode marker with parent denies", () => {
  const subagent = {
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
  } as unknown as Agent.Info

  const result = deriveSubagentSessionPermission({
    parentSessionPermission: [
      { permission: "__opencode_approval_mode__", pattern: "auto", action: "allow" },
      { permission: "bash", pattern: "rm *", action: "deny" },
      { permission: "edit", pattern: "*", action: "allow" },
    ],
    subagent,
  })

  expect(result).toContainEqual({
    permission: "__opencode_approval_mode__",
    pattern: "auto",
    action: "allow",
  })
  expect(result).toContainEqual({ permission: "bash", pattern: "rm *", action: "deny" })
  expect(result).not.toContainEqual({ permission: "edit", pattern: "*", action: "allow" })
})
