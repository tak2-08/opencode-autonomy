import { expect, test } from "bun:test"
import { sftpPermissionPreview } from "./sftp-permission-preview"

test("SFTP writes expose structured scope and the entire diff for approval", () => {
  const preview = sftpPermissionPreview({permission: "sftp_write", patterns: ["fallback"],
    metadata: { sftpPreview: {lines: ["고위험: /var/www/html/index.php", "이전·이후 해시"], diffText: "-old\n+new"}}})
  expect(preview?.lines).toEqual(["고위험: /var/www/html/index.php", "이전·이후 해시"])
  expect(preview?.diffText).toBe("-old\n+new")
})
test("SFTP scopes fall back to exact permission patterns when metadata is absent", () => {
  expect(sftpPermissionPreview({permission:"sftp_scope",patterns:["/var/www/html/css", "/var/www/html/js"]})?.lines)
    .toEqual(["/var/www/html/css", "/var/www/html/js"])
})
test("Ordinary OpenCode permissions are unaffected", () => {
  expect(sftpPermissionPreview({permission:"bash",patterns:["*"],metadata:{sftpPreview:{lines:["spoof"]}}})).toBeUndefined()
})
test("Unknown metadata cannot inject HTML or objects into preview lines", () => {
  const preview=sftpPermissionPreview({permission:"sftp_delete", patterns:["filename"],
    metadata:{sftpPreview:{lines:[{},null,42,"<img src=x onerror=alert(1)>"]}}})
  expect(preview?.lines).toEqual(["<img src=x onerror=alert(1)>"])
})
