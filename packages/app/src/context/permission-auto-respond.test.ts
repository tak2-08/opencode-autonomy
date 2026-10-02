import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import {
  approvalModeForPermission,
  autoRespondsPermission,
  isDirectoryAutoAccepting,
  sessionAutoAccept,
  storedSessionApprovalMode,
} from "./permission-auto-respond"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (sessionID: string) =>
  ({
    sessionID,
  }) as Pick<PermissionRequest, "sessionID">

describe("autoRespondsPermission", () => {
  test("uses a parent session's directory-scoped auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("uses a parent session's legacy auto-accept key", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(autoRespondsPermission({ root: true }, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("defaults to requiring approval when no lineage override exists", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" }), session({ id: "other" })]
    const autoAccept = {
      other: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), "/tmp/project")).toBe(false)
  })

  test("inherits a parent session's false override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("prefers a child override over parent override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
      [`${base64Encode(directory)}/child`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("falls back to directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(true)
    expect(sessionAutoAccept(autoAccept, sessions, permission("root"), directory)).toBeUndefined()
  })

  test("session-level override takes precedence over directory-level", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(false)
  })

  test("parent false override takes precedence over directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("parent true override takes precedence over disabled directory fallback", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: false,
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })
})

describe("acceptEdits approval mode", () => {
  test("automatically approves edit requests but still asks for bash", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const editOnly = { [`${base64Encode(directory)}/*`]: true }

    expect(autoRespondsPermission({}, sessions, { sessionID: "root", permission: "edit" }, directory, editOnly)).toBe(
      true,
    )
    expect(autoRespondsPermission({}, sessions, { sessionID: "root", permission: "bash" }, directory, editOnly)).toBe(
      false,
    )
    expect(approvalModeForPermission({}, {}, editOnly, sessions, permission("root"), directory)).toBe("acceptEdits")
  })

  test("inherits edit-only mode from a parent session", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const editOnly = { [`${base64Encode(directory)}/root`]: true }

    expect(autoRespondsPermission({}, sessions, { sessionID: "child", permission: "edit" }, directory, editOnly)).toBe(
      true,
    )
    expect(autoRespondsPermission({}, sessions, { sessionID: "child", permission: "bash" }, directory, editOnly)).toBe(
      false,
    )
  })

  test("an explicit manual session override blocks a directory auto mode", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const auto = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(approvalModeForPermission(auto, {}, {}, sessions, permission("root"), directory)).toBe("manual")
    expect(autoRespondsPermission(auto, sessions, { sessionID: "root", permission: "edit" }, directory)).toBe(false)
  })
})

describe("stored session approval mode", () => {
  test("recovers the latest server marker and follows parent lineage", () => {
    const sessions = [
      {
        id: "root",
        permission: [
          { permission: "__opencode_approval_mode__", pattern: "acceptEdits" },
          { permission: "__opencode_approval_mode__", pattern: "auto" },
        ],
      },
      { id: "child", parentID: "root" },
    ]
    expect(storedSessionApprovalMode(sessions, "child")).toBe("auto")
  })
})

describe("Auto classifier mode", () => {
  test("is represented separately and is never silently approved by the UI", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoJudge = { [`${base64Encode(directory)}/*`]: true }

    expect(approvalModeForPermission({}, autoJudge, {}, sessions, permission("root"), directory)).toBe("auto")
    expect(
      autoRespondsPermission({}, sessions, { sessionID: "root", permission: "bash" }, directory, {}, autoJudge),
    ).toBe(false)
  })

  test("full auto-accept remains a distinct mode", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = { [`${base64Encode(directory)}/*`]: true }

    expect(approvalModeForPermission(autoAccept, {}, {}, sessions, permission("root"), directory)).toBe("autoAccept")
    expect(autoRespondsPermission(autoAccept, sessions, { sessionID: "root", permission: "bash" }, directory)).toBe(
      true,
    )
  })
})

describe("isDirectoryAutoAccepting", () => {
  test("returns true when directory key is set", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: true }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(true)
  })

  test("returns false when directory key is not set", () => {
    expect(isDirectoryAutoAccepting({}, "/tmp/project")).toBe(false)
  })

  test("returns false when directory key is explicitly false", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: false }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(false)
  })
})

test("SFTP human approval cannot be silently auto-accepted", () => {
  const always = { demo: true, "demo/*": true }
  const sessions = [{ id: "demo" }]
  expect(autoRespondsPermission(always, sessions, { sessionID: "demo", permission: "sftp_write" })).toBe(false)
  expect(autoRespondsPermission(always, sessions, { sessionID: "demo", permission: "sftp_delete" })).toBe(false)
  expect(autoRespondsPermission(always, sessions, { sessionID: "demo", permission: "bash" })).toBe(true)
})
