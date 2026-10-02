# Customizations

This fork starts from OpenCode **v1.18.22** and contains only source-level customizations intended to be portable across installations.

## Permission approval modes

The Web UI exposes four distinct modes:

1. **Manual** — follow the normal OpenCode permission rules.
2. **Accept edits** — automatically approve edit permissions only.
3. **Auto · subagent decides** — use an internal session child agent to classify unresolved permission requests.
4. **Auto-accept permissions** — automatically accept ordinary unresolved permission requests.

The Auto classifier returns exactly one of ALLOW, ASK, or DENY. It is hidden, has no tools, and uses recent parent-session context plus permission-request metadata. Invalid output, timeout, or classifier errors fall back to ASK.

Static policy remains authoritative: an explicit deny cannot be overridden by Auto.

## SFTP boundary

SFTP actions are deliberately excluded from automatic approval. sftp_* permissions continue through the normal human approval path in both Auto and auto-accept modes.

The SFTP setup route stores its secret in the OpenCode configuration area at runtime. No real credential, generated private key, stored password, host fingerprint, or local runtime configuration is committed to this repository.

Public deployments can configure the SFTP target with `OPENCODE_SFTP_HOST`, `OPENCODE_SFTP_PORT`, `OPENCODE_SFTP_USER`, and `OPENCODE_SFTP_SETUP_CLIENT_PATH`. No machine-specific username is hardcoded in the public source.

## Session behavior

Approval mode is represented by a session-scoped internal permission marker and is persisted before the first prompt of a newly created session. Ordinary task subagents inherit the marker, while the internal permission classifier is created separately with all tool permissions denied.

## Media and Web UI changes

The fork also contains fixes for persisted tool-result image attachments, message-part media rendering, prompt attachment handling, and mobile/Web UI behavior.

## Validation performed during development

The customized permission logic was covered by focused application and server tests. Runtime imports for the modified server permission path were also checked. A full source build of OpenCode 1.18.22 completed successfully and the resulting executable passed its version smoke test.

The upstream OpenCode project and license remain authoritative for all unmodified upstream code.
