# OpenCode Telegram Bridge Plugin

## Locked Product Decisions

- Build as a TUI-scoped OpenCode plugin
- Telegram source is strict channel only
- Telegram target is the currently active OpenCode session only in v1
- Telegram response is summary only
- Permission prompts must be approve or deny from Telegram immediately
- Binding is explicit and local through OpenCode commands
- Bridge lifetime is tied to the owning OpenCode terminal session

## Why TUI Plugin, Not Server Plugin

- The user workflow is session-oriented, not globally always-on
- A TUI plugin can bind to the exact active session the user chooses
- TUI lifecycle disposal gives a clean shutdown path on normal exit or `Ctrl+C`
- This makes ownership and online/offline semantics easier to reason about

## Telegram Command Contract

Supported channel commands in v1:

- `/tp <prompt text>`
- `/tp approve <request_id>`
- `/tp approve-always <request_id>`
- `/tp deny <request_id>`
- `/tp status`
- `/tp:interrupt`
- `/tp:queue`
- `/tp:cancel <job_id|last>`
- `/tp:retry`
- `/tp:context`
- `/tp:compact`
- `/tp:newsession`
- `/tp:reset-context`
- `/tp:who`
- `/tp:health`
- `/tp:reclaim`
- `/tp:history`
- `/tp:last-error`
- `/tp:model`
- `/tp:model fast`
- `/tp:model smart`
- `/tp:model max`
- `/tp:model <provider>/<model>`

Unsupported in v1:

- Full-output retrieval
- Question answering
- Rebinding from Telegram
- Multi-channel routing

## Session Ownership Model

The bridge is owned by one OpenCode console instance at a time.

Owner lifecycle:

1. `telegram.bind` claims ownership lease
2. Plugin starts heartbeat while TUI remains active
3. `api.lifecycle.onDispose` performs normal cleanup
4. If process dies uncleanly, heartbeat expires and a later console can reclaim

This is required because a new OpenCode console can be opened later, and the system must avoid two consoles acting on the same Telegram channel concurrently.

## Binding Policy

V1 binding rules:

- Bind only from the local OpenCode TUI
- Bind to the current real session only
- Do not auto-bind on startup
- Do not auto-create sessions in v1

Rationale:

- Keeps behavior explicit
- Avoids accidental routing into the wrong session
- Leaves room for v2 dedicated session-per-chat support

## Shutdown Policy

Normal shutdown:

- Stop Telegram poller
- Stop owner heartbeat
- Release lease
- Mark bridge offline
- Optionally notify Telegram channel

Unclean shutdown:

- Lease remains until TTL expires
- Next OpenCode console can reclaim after stale-owner detection

This specifically covers the user request to think through closing OpenCode with `Ctrl+C` or similar interruption.

## Response Policy

Channel replies must be summary only.

Summary priorities:

1. Assistant’s final useful text result
2. Short note on changed files, if available
3. Error or blocked-state message when needed

No full transcript or raw streaming output in v1.

## Permission Policy

When OpenCode emits a permission request:

1. Plugin posts a compact Telegram action message
2. User approves or denies in Telegram with explicit request ID
3. Plugin immediately calls OpenCode permission reply API

Allowed replies:

- `once`
- `always`
- `reject`

No silent auto-approval by default.

## Main Risks To Watch During Implementation

- Correlating assistant completion with the correct Telegram-originated prompt
- Handling shutdown during active polling or active session work
- Preventing self-trigger loops from plugin-generated channel messages
- Avoiding double ownership across multiple OpenCode consoles
- Making permission request messages compact but still actionable

## Guidance For A Future Implementation Session

- Do not start with UI polish; build the runtime path first
- Keep persistence simple and debuggable
- Favor deterministic IDs for Telegram-to-session correlation
- Make logging explicit around lease, polling, prompt submission, and permission replies
- Treat shutdown behavior as part of core functionality, not a later refinement

## Expected Deliverables For Implementation Session

- Working TUI plugin source
- Buildable package
- README with setup steps
- Manual validation against a real Telegram channel and OpenCode session

## V2 Direction

Planned later, not part of v1:

- Dedicated remote session per chat
- Session creation strategy when a new OpenCode console opens
- Possibly richer remote control beyond permission replies

## Prioritized Backlog

### P1

- `/tp:interrupt`
  - Stop the active Telegram-triggered run without dropping bridge ownership or unlocking the session.
  - This is the highest-value remote control action after prompt submission.
- Remote lifecycle notifications
  - Post compact state changes to Telegram for accepted, queued, running, waiting-permission, completed, and failed.
  - Goal: remove ambiguity about whether the remote command is progressing.
- Reply-threaded Telegram output
  - Send result summaries as replies to the originating Telegram channel post.
  - Goal: preserve prompt/result correlation in busy channels.
- Operator-grade `/tp:status`
  - Include session ID, working directory, branch, current model, active run age, queue size, permission count, and heartbeat freshness.
  - Goal: make remote status actionable without opening the local TUI.

### P2

- Queue control surface
  - Add `/tp:queue`, `/tp:cancel <job_id|last>`, and `/tp:retry`.
  - Goal: let Telegram act as a real remote operations console instead of a blind inbox.
- `/tp:context`
  - Return compact session context such as title, recent user requests, last assistant summary, and recent changed files.
  - Goal: help the operator re-enter a live session quickly.
- Permission UX upgrade
  - Make permission prompts more decision-friendly by including permission/tool type, target path/pattern, risk label, and exact reply examples.
  - Goal: reduce Telegram-side approval latency and mistakes.
- Model presets
  - Support friendly selectors such as `/tp:model fast`, `/tp:model smart`, and `/tp:model max` in addition to raw provider/model IDs.
  - Goal: reduce friction when switching models remotely.

### P3

- `/tp:compact`
  - Compact or summarize long-running session context from Telegram.
  - Goal: keep remote-first sessions healthy over time.
- Bound-session reset flow
  - Add `/tp:newsession` or `/tp:reset-context` semantics for starting fresh without changing the v1 single-session binding policy.
  - Goal: recover from polluted context without reopening the bridge manually.
- Ownership and recovery diagnostics
  - Add `/tp:who`, `/tp:health`, and `/tp:reclaim`.
  - Goal: make stale lease and unexpected disconnect cases diagnosable from Telegram.
- Lightweight audit trail
  - Add `/tp:history` and `/tp:last-error`.
  - Goal: expose recent operational events without requiring full transcript support.
