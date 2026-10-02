import { constants, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, randomBytes } from "node:crypto"
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest"

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const KEY_PATH = join(CONFIG_DIR, "sftp-setup-rsa.pem")
const SECRET_PATH = join(CONFIG_DIR, "sftp-secrets.json")
const CLIENT_PATH = process.env.OPENCODE_SFTP_SETUP_CLIENT_PATH ?? "/workspace/.opencode/sftp-guard/web/sftp-setup-client.js"
const TARGET_HOST = process.env.OPENCODE_SFTP_HOST ?? "172.17.0.1"
const TARGET_PORT = (() => {
  const value = Number.parseInt(process.env.OPENCODE_SFTP_PORT ?? "22", 10)
  return Number.isInteger(value) && value >= 1 && value <= 65_535 ? value : 22
})()
const TARGET_USER = process.env.OPENCODE_SFTP_USER ?? "opencode"
const CHALLENGE_TTL_MS = 120_000
const challenges = new Map<string, { expires: number; keyId: string; hostKeySha256: string }>()

function secure(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.setHeaders(response, {
    "cache-control": "no-store, max-age=0", pragma: "no-cache",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
  })
}
function json(body: unknown, status = 200) {
  return secure(HttpServerResponse.jsonUnsafe(body, { status }))
}
function checkPrivateFile(path: string) {
  if (!existsSync(path)) return
  const st = lstatSync(path)
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("invalid secure file")
  if ((st.mode & 0o077) !== 0) throw new Error("insecure file mode")
}
function atomicWrite(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path)) checkPrivateFile(path)
  const tmp = join(dirname(path), ".sftp-secure-" + process.pid + "-" + randomBytes(6).toString("hex"))
  const fd = openSync(tmp, "wx", 0o600)
  try { writeFileSync(fd, body, { encoding: "utf8" }); fsyncSync(fd) } finally { closeSync(fd) }
  chmodSync(tmp, 0o600)
  try { renameSync(tmp, path) } catch (error) { try { unlinkSync(tmp) } catch {}; throw error }
}
function privatePem() {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  if (existsSync(KEY_PATH)) { checkPrivateFile(KEY_PATH); return readFileSync(KEY_PATH, "utf8") }
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 3072, publicExponent: 0x10001,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  atomicWrite(KEY_PATH, pair.privateKey)
  return pair.privateKey
}
function publicInfo() {
  const publicKey = createPublicKey(createPrivateKey(privatePem()))
  const jwk = publicKey.export({ format: "jwk" })
  if (!jwk.n || !jwk.e) throw new Error("public key unavailable")
  const der = publicKey.export({ type: "spki", format: "der" })
  return { publicKey: { kty: "RSA", n: jwk.n, e: jwk.e }, keyId: createHash("sha256").update(der).digest("hex") }
}
function observedHostKeySha256() {
  const output = execFileSync("ssh-keyscan", ["-T", "3", "-t", "ed25519", "-p", String(TARGET_PORT), TARGET_HOST], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000,
  })
  const row = output.split(/\r?\n/).find((line) => line && !line.startsWith("#"))?.trim().split(/\s+/)
  if (!row || row[1] !== "ssh-ed25519" || !row[2]) throw new Error("host key unavailable")
  return createHash("sha256").update(Buffer.from(row[2], "base64")).digest("hex")
}
function cleanupChallenges() {
  const now = Date.now()
  for (const [id, value] of challenges) if (value.expires <= now) challenges.delete(id)
  while (challenges.size >= 64) challenges.delete(challenges.keys().next().value!)
}
function sameOrigin(request: HttpServerRequest) {
  const origin = request.headers.origin, host = request.headers.host
  if (!origin || !host) return false
  try {
    const location = new URL(origin)
    if (location.host !== host) return false
    // 원격 HTTP에서는 페이지 자체를 MITM으로 변조할 수 있다.
    // RSA-OAEP만으로 안전하다고 오인하지 않도록 HTTPS 또는 호스트 로컬만 허용한다.
    if (location.protocol !== "https:" &&
        !(location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)))
      return false
    const site = request.headers["sec-fetch-site"]
    return !site || site === "same-origin" || site === "none"
  } catch { return false }
}
function configured() {
  if (!existsSync(SECRET_PATH)) return false
  try { checkPrivateFile(SECRET_PATH); return true } catch { return false }
}
function challenge() {
  cleanupChallenges()
  const key = publicInfo(), hostKeySha256 = observedHostKeySha256()
  const token = randomBytes(32).toString("base64url"), expires = Date.now() + CHALLENGE_TTL_MS
  challenges.set(token, { expires, keyId: key.keyId, hostKeySha256 })
  return { ...key, challenge: token, expiresAt: new Date(expires).toISOString(), hostKeySha256 }
}
function decryptEnvelope(input: { challenge: string; keyId: string; hostKeySha256: string; ciphertext: string }) {
  cleanupChallenges()
  const pending = challenges.get(input.challenge)
  challenges.delete(input.challenge)
  if (!pending || pending.expires <= Date.now()) throw new Error("expired challenge")
  if (pending.keyId !== input.keyId || pending.hostKeySha256 !== input.hostKeySha256) throw new Error("challenge mismatch")
  if (observedHostKeySha256() !== pending.hostKeySha256) throw new Error("host key changed")
  const ciphertext = Buffer.from(input.ciphertext.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const clear = privateDecrypt({
    key: privatePem(), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256",
  }, ciphertext)
  const payload = JSON.parse(clear.toString("utf8")) as { v?: unknown; challenge?: unknown; password?: unknown }
  if (payload.v !== 1 || payload.challenge !== input.challenge || typeof payload.password !== "string") throw new Error("payload mismatch")
  const bytes = Buffer.byteLength(payload.password, "utf8")
  if (bytes < 1 || bytes > 128) throw new Error("invalid secret length")
  return payload.password
}
function saveSecret(password: string, hostKeySha256: string) {
  const value = {
    connection: {
      host: TARGET_HOST, port: TARGET_PORT, username: TARGET_USER, hostKeySha256,
      readyTimeoutMs: 20_000, keepaliveIntervalMs: 15_000, keepaliveCountMax: 3,
    },
    password, passwordFromEnv: false,
  }
  atomicWrite(SECRET_PATH, JSON.stringify(value, null, 2) + "\n")
}
function setupPage() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenCode SFTP 설정</title>
<style>:root{font-family:system-ui,sans-serif;color-scheme:dark light}body{margin:0;background:#111;color:#eee;min-height:100vh;display:grid;place-items:center}.card{width:min(620px,calc(100vw - 32px));padding:24px;box-sizing:border-box;border:1px solid #444;border-radius:14px;background:#181818}.row{display:grid;grid-template-columns:150px 1fr;gap:8px;margin:9px 0}.muted{color:#aaa;font-size:13px}.warn{background:#4b280d;padding:12px;border-radius:9px;margin:14px 0}.ok{color:#70d68a}.error{color:#ff8e8e}input{box-sizing:border-box;width:100%;padding:11px;border-radius:8px;border:1px solid #555;background:#0d0d0d;color:#fff}button{margin-top:14px;padding:10px 16px;border:0;border-radius:8px;font-weight:700}code{overflow-wrap:anywhere}</style></head><body><main class="card"><h1>SFTP 보안 설정</h1>
<p class="muted">비밀번호는 채팅/LLM/URL을 거치지 않고 브라우저에서 RSA-OAEP(SHA-256) 암호화 후 암호문만 전송합니다.</p>
<div id="warning" class="warn"><strong>원격 HTTP에서는 비밀번호 저장 금지:</strong> HTTP 응답의 JavaScript를 변조하는 공격을 RSA 암호화만으로 막을 수 없습니다. HTTPS 또는 Ubuntu 호스트에서 직접 실행하는 로컬 TTY 설정을 이용하세요. 서버는 원격 HTTP에서 저장 요청을 거부합니다.</div>
<div class="row"><span>상태</span><strong id="configured">확인 중</strong><span>대상</span><code id="target">확인 중</code><span>SSH 키 지문</span><code id="fingerprint">확인 중</code></div>
<form id="form" autocomplete="off"><label for="password">OpenCode SFTP 비밀번호</label><input id="password" type="password" autocomplete="new-password" maxlength="128" required><button id="save" type="submit">암호화하여 저장</button></form>
<p id="message" class="muted" aria-live="polite"></p><p class="muted">파일 권한 600을 강제합니다. 저장 후 새 OpenCode 인스턴스 로드가 필요합니다.</p></main><script src="/sftp/setup/client.js" defer></script></body></html>`
}
function credentials(request: HttpServerRequest) {
  return Effect.gen(function* () {
    if (!sameOrigin(request) || request.headers["x-opencode-sftp-setup"] !== "1")
      return json({ ok: false, message: "same-origin 요청만 허용합니다." }, 403)
    const declared = request.headers["content-length"]
    const length = declared === undefined ? NaN : Number(declared)
    if (!Number.isSafeInteger(length) || length <= 0 || length > 16_384)
      return json({ ok: false, message: "명시적인 Content-Length(최대 16KiB)가 필요합니다." }, 413)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? ""))
      return json({ ok: false, message: "JSON 요청만 허용합니다." }, 415)
    const body = yield* request.json
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, message: "요청 형식 오류" }, 400)
    const value = body as Record<string, unknown>
    for (const key of ["challenge", "keyId", "hostKeySha256", "ciphertext"])
      if (typeof value[key] !== "string") return json({ ok: false, message: "요청 형식 오류" }, 400)
    try {
      const input = value as { challenge: string; keyId: string; hostKeySha256: string; ciphertext: string }
      saveSecret(decryptEnvelope(input), input.hostKeySha256)
      return json({ ok: true, reloadRequired: true })
    } catch {
      return json({ ok: false, message: "암호화된 SFTP 설정을 검증하거나 저장하지 못했습니다." }, 400)
    }
  }).pipe(Effect.catch(() => Effect.succeed(json({ ok: false, message: "SFTP 설정 처리 실패" }, 400))))
}
export const SftpSetup = { challenge, decryptEnvelope, saveSecret, publicInfo, observedHostKeySha256, sameOrigin }
export const sftpSetupRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", "/sftp/setup", () => Effect.succeed(HttpServerResponse.setHeaders(secure(HttpServerResponse.html(setupPage())), {
      "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    })))
    yield* router.add("GET", "/sftp/setup/client.js", () => Effect.try({
      try: () => secure(HttpServerResponse.text(readFileSync(CLIENT_PATH, "utf8"), { headers: { "content-type": "text/javascript; charset=utf-8" } })),
      catch: () => json({ message: "client unavailable" }, 503),
    }))
    yield* router.add("GET", "/sftp/setup/status", () => Effect.try({
      try: () => json({ configured: configured(), target: `${TARGET_USER}@${TARGET_HOST}:${TARGET_PORT}`, hostKeySha256: observedHostKeySha256() }),
      catch: () => json({ configured: configured(), target: `${TARGET_USER}@${TARGET_HOST}:${TARGET_PORT}`, hostKeySha256: null }, 503),
    }))
    yield* router.add("GET", "/sftp/setup/challenge", () => Effect.try({ try: () => json(challenge()), catch: () => json({ message: "challenge 생성 실패" }, 503) }))
    yield* router.add("POST", "/sftp/setup/credentials", credentials)
  }),
)
