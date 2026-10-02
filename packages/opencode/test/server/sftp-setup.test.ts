import { expect, test } from "bun:test"
import { SftpSetup } from "../../src/server/sftp-setup"

// 비밀번호 입력 엔드포인트는 동일 출처 HTTPS 또는 호스트 루프백만 허용한다.
const origin = (address: string, host = "opencode.example:46000", site = "same-origin") =>
  ({ headers: { origin: address, host, "sec-fetch-site": site } }) as never

test("SFTP setup allows same-origin HTTPS", () => {
  expect(SftpSetup.sameOrigin(origin("https://opencode.example:46000"))).toBe(true)
})
test("SFTP setup allows only true local HTTP", () => {
  expect(SftpSetup.sameOrigin(origin("http://127.0.0.1:46000", "127.0.0.1:46000"))).toBe(true)
  expect(SftpSetup.sameOrigin(origin("http://localhost:46000", "localhost:46000"))).toBe(true)
})
test("SFTP setup refuses remote HTTP even from the same host", () => {
  expect(SftpSetup.sameOrigin(origin("http://opencode.example:46000"))).toBe(false)
  expect(SftpSetup.sameOrigin(origin("http://192.168.1.20:46000", "192.168.1.20:46000"))).toBe(false)
})
test("SFTP setup refuses cross-origin and cross-site submissions", () => {
  expect(SftpSetup.sameOrigin(origin("https://attacker.example:46000"))).toBe(false)
  expect(SftpSetup.sameOrigin(origin("https://opencode.example:46000", "opencode.example:46000", "cross-site"))).toBe(false)
  expect(SftpSetup.sameOrigin({ headers: { host: "opencode.example:46000" } } as never)).toBe(false)
})
