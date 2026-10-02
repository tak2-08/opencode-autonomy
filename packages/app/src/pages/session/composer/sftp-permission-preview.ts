// SFTP 전용 승인 요청의 미리보기만 UI에 노출한다. 문자열은 Solid의 텍스트 바인딩으로 출력한다.
export type SftpPermissionPreview = { lines: string[]; diffText?: string }

export function sftpPermissionPreview(input: {
  permission: string
  patterns: readonly string[]
  metadata?: Record<string, unknown>
}): SftpPermissionPreview | undefined {
  if (!input.permission.startsWith('sftp_')) return undefined
  const raw = input.metadata?.sftpPreview
  const data = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined
  const lines = Array.isArray(data?.lines) ? data.lines.filter((x): x is string => typeof x === 'string') : []
  const diffText = typeof data?.diffText === 'string' ? data.diffText : undefined
  return { lines: lines.length ? lines : [...input.patterns], diffText }
}
