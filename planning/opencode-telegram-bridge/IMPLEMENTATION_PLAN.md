# OpenCode Telegram Bridge Plugin

## Status

Implementation complete for v1/P1/P2/P3 scope. Remaining unchecked items are external release operations (`npm publish` and optional ecosystem listing). Live Telegram E2E remains dependent on real bot/channel credentials in the runtime environment.

## Change Log (Current Session)

- [x] Added local slash-command flow: `/tp:start`, `/tp:stop`, `/tp:status`
- [x] Added local input lock while teleprompt is active on bound session
- [x] Added double-ESC disconnect handling via TUI command events
- [x] Added Telegram remote disconnect command: `/tp:dc`
- [x] Added backlog item for public distribution via npm registry (do last)
- [x] Added Telegram model management flow: `/tp:model` and `/tp:model <provider>/<model>`
- [x] Added Telegram remote interrupt command: `/tp:interrupt`
- [x] Added remote lifecycle notifications for prompt jobs (`accepted`, `queued`, `running`, `waiting-permission`, `completed`, `failed`)
- [x] Added reply-threaded Telegram result delivery tied to originating prompt messages
- [x] Expanded `/tp:status` with operator-focused runtime details (cwd, branch, heartbeat age, active elapsed time)
- [x] Added queue management commands: `/tp:queue`, `/tp:cancel <job_id|last>`, `/tp:retry`
- [x] Added `/tp:context` for compact session context (recent requests, last summaries, recent changed files)
- [x] Improved permission request formatting with tool/risk/target and explicit reply examples
- [x] Added model presets: `/tp:model fast`, `/tp:model smart`, `/tp:model max`
- [x] Added `/tp:compact` command using session summarize flow
- [x] Added bound-session reset/switch commands: `/tp:newsession`, `/tp:reset-context`
- [x] Added lease diagnostics/recovery commands: `/tp:who`, `/tp:health`, `/tp:reclaim`
- [x] Added remote history/error commands: `/tp:history`, `/tp:last-error`
- [x] Added npm publish preparation scripts/metadata and release verification command
- [x] Added clean-machine install checklist and Telegram live E2E checklist to README
- [x] Hardened multi-instance ownership handling by syncing state from disk and owner-gating remote command execution
- [x] Fixed owner-safety on local lifecycle paths (`/tp:start`, `/tp:stop`, double-ESC, shutdown) using fresh state checks
- [x] Fixed Telegram update durability by persisting polling offset only after successful command handling
- [x] Added event stream crash recovery with auto-restart and duplicate-stream prevention
- [x] Re-ran release readiness checks after runtime hardening (`typecheck`, `build`, `verify:release`)

## Implementation Checklist

- [x] Scaffold package/tooling files (`package.json`, `tsconfig.json`, `.gitignore`, `README.md`)
- [x] Create full source tree from planned layout
- [x] Implement config loading and validation
- [x] Implement persistent bridge state store
- [x] Implement lease ownership + heartbeat semantics
- [x] Implement Telegram API wrapper + parser + long poller
- [x] Implement OpenCode binding, submission, event stream, permission reply helpers
- [x] Implement runtime controller orchestration and lifecycle shutdown path
- [x] Register TUI commands (`telegram.bind`, `telegram.unbind`, `telegram.status`)
- [x] Run build/typecheck and fix compile/runtime issues
- [x] Finalize docs with exact run/activation instructions validated against build output

## Backlog (Do Last)

- [ ] Publish package to npm registry (`opencode-plugin-teleprompt`) (requires npm owner credentials)
- [x] Complete npm publish preparation (`verify:release`, metadata, license, prepublish guard)
- [x] Verify install flow documentation via `opencode.json` plugin list on a clean machine checklist:
  - `"plugin": ["opencode-plugin-teleprompt"]`
- [ ] Optional: submit plugin to OpenCode ecosystem/community plugin list after npm publish

## Product Backlog

### P1

- [x] Add `/tp:interrupt` to stop the active Telegram-triggered run without disconnecting the bridge
- [x] Send lifecycle notices for remote jobs:
  - accepted
  - queued
  - running
  - waiting-permission
  - completed
  - failed
- [x] Send summary replies as Telegram replies to the originating channel message for prompt/result correlation
- [x] Expand `/tp:status` into an operator-focused status report including:
  - session ID
  - current working directory
  - git branch if available
  - selected model
  - active job elapsed time
  - queue size
  - pending permission count
  - owner heartbeat freshness

### P2

- [x] Add queue management commands:
  - `/tp:queue`
  - `/tp:cancel <job_id|last>`
  - `/tp:retry`
- [x] Add `/tp:context` for compact session situational awareness:
  - session title if available
  - last few user requests
  - last assistant summary
  - recent changed files
- [x] Improve permission request messages with compact action-oriented metadata:
  - permission/tool type
  - target path or pattern
  - risk label (`read`, `write`, `exec`, `network`)
  - exact reply examples
- [x] Add model presets on top of raw provider/model selection:
  - `/tp:model fast`
  - `/tp:model smart`
  - `/tp:model max`

### P3

- [x] Add `/tp:compact` to summarize or compact long-lived session context for healthier remote operation
- [x] Add session reset flow for the currently bound session without changing the v1 ownership model:
  - `/tp:newsession` or
  - `/tp:reset-context`
- [x] Add bridge ownership and recovery diagnostics:
  - `/tp:who`
  - `/tp:health`
  - `/tp:reclaim`
- [x] Add lightweight remote audit/history commands:
  - `/tp:history`
  - `/tp:last-error`

## Goal

Build a TUI-scoped OpenCode plugin that binds a Telegram channel to the currently active OpenCode session. A channel post command should be injected into the bound session, and when the assistant finishes, the plugin should send a summary-only response back to the same Telegram channel.

## V1 Scope

- Strict Telegram channel support only
- Bind to the currently active OpenCode session only
- Summary-only Telegram responses
- Approve or deny OpenCode permission prompts from Telegram immediately
- Bridge lifetime tied to the owning OpenCode TUI session
- Clean shutdown on normal exit and stale-owner recovery on unclean exit

## Out of Scope for V1

- Dedicated remote session per chat
- Multiple channel bindings
- Telegram-side answering of OpenCode question prompts
- Full response retrieval
- Webhook delivery
- Auto-binding on every new OpenCode launch

## Recommended Folder Layout

```text
.
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
└── src
    ├── tui.ts
    ├── config.ts
    ├── types.ts
    ├── state
    │   ├── store.ts
    │   └── lease.ts
    ├── telegram
    │   ├── api.ts
    │   ├── parser.ts
    │   └── poller.ts
    ├── opencode
    │   ├── binding.ts
    │   ├── submit.ts
    │   ├── events.ts
    │   └── permissions.ts
    ├── summary
    │   └── format.ts
    └── runtime
        ├── controller.ts
        └── shutdown.ts
```

## File-by-File Plan

### `package.json`

- Define package name and ESM module type
- Add `build` and `typecheck` scripts
- Keep runtime dependencies minimal
- Use OpenCode plugin and SDK packages
- Export compiled TUI entrypoint

### `tsconfig.json`

- Emit ESM output to `dist/`
- Use strict TypeScript settings
- Target modern runtime features already available in Bun or Node

### `.gitignore`

- Ignore `dist/`
- Ignore temporary runtime files and local env files used for manual testing

### `README.md`

- Explain what the plugin does
- Document installation and activation flow
- Document required env vars:
  - `OPENCODE_TELEGRAM_BOT_TOKEN`
  - `OPENCODE_TELEGRAM_CHANNEL_ID`
- Document Telegram setup requirements for channel posting
- Document v1 limitations and shutdown semantics

### `src/tui.ts`

- Main TUI plugin entrypoint
- Register local commands:
  - `telegram.bind`
  - `telegram.unbind`
  - `telegram.status`
- Initialize runtime controller
- Hook cleanup into `api.lifecycle.onDispose`
- Ensure bridge lifetime follows the owning OpenCode terminal session

### `src/config.ts`

- Read config from environment
- Validate bot token and channel ID
- Normalize polling timeout, summary length, prefix, and heartbeat defaults
- Surface actionable startup errors

### `src/types.ts`

- Internal types for:
  - Telegram updates and commands
  - bridge runtime state
  - pending prompt jobs
  - pending permission requests
  - ownership lease
  - summary payloads

### `src/state/store.ts`

- Persist durable bridge state
- Store:
  - bound session ID
  - Telegram channel ID
  - polling offset
  - owner instance ID
  - owner heartbeat timestamp
  - pending prompt jobs
  - pending permission requests
  - bridge status
- Use atomic writes

### `src/state/lease.ts`

- Implement single-owner locking
- Prevent multiple OpenCode consoles from controlling the same bridge simultaneously
- Track instance ownership with heartbeat and TTL
- Release on normal shutdown
- Allow stale lock recovery after crash or `Ctrl+C`

### `src/telegram/api.ts`

- Wrap Telegram Bot API calls
- Implement:
  - `getUpdates`
  - `sendMessage`
- Restrict updates to `channel_post`
- Add retries, error parsing, and text chunking for long summaries

### `src/telegram/parser.ts`

- Parse channel posts into internal commands
- Enforce:
  - strict channel ID match
  - `/tp` prefix requirement
- Support:
  - `/tp <prompt>`
  - `/tp approve <request_id>`
  - `/tp approve-always <request_id>`
  - `/tp deny <request_id>`
  - `/tp status`
- Ignore plugin’s own non-command summaries

### `src/telegram/poller.ts`

- Long-poll Telegram updates
- Persist `update_id` offset after processing
- Stop immediately when abort signal fires
- Forward parsed commands into the runtime controller

### `src/opencode/binding.ts`

- Resolve and validate the current OpenCode session from TUI context
- Bind only when user is on a real session route
- Expose:
  - bind current session
  - unbind session
  - status lookup
- Keep binding explicit in v1

### `src/opencode/submit.ts`

- Inject Telegram prompt text into the bound OpenCode session
- Use deterministic message IDs derived from Telegram update IDs
- Submit through `client.session.promptAsync`
- Track mapping between Telegram update and injected OpenCode user message

### `src/opencode/events.ts`

- Subscribe to OpenCode runtime events
- Watch:
  - `message.updated`
  - `message.part.updated`
  - `session.idle`
  - `permission.asked`
  - `permission.replied`
  - `session.error`
- Correlate final assistant response with injected Telegram-originated user message
- Accumulate final assistant text needed for summary generation

### `src/opencode/permissions.ts`

- Translate `permission.asked` into Telegram approval request messages
- Include request ID and compact permission description
- Handle Telegram approval commands by calling OpenCode permission reply APIs:
  - `once`
  - `always`
  - `reject`
- Clear pending permission state after reply or terminal error

### `src/summary/format.ts`

- Produce the summary-only Telegram response
- Prefer concise assistant result text
- Optionally augment with changed-file list from session diff metadata
- Ensure output fits Telegram limits and is readable in channel format

### `src/runtime/controller.ts`

- Central orchestrator for the plugin
- Own:
  - startup
  - shutdown
  - queueing
  - bridge state transitions
  - command dispatch
  - permission handoff
  - summary publishing
- Enforce one active remote prompt at a time per bound session

### `src/runtime/shutdown.ts`

- Stop polling on shutdown
- Stop lease heartbeat
- Release or expire ownership cleanly
- Optionally send final offline notification to Telegram
- Handle stale-owner recovery assumptions for crashed sessions

## Runtime Flows

### 1. Bind Flow

1. User opens OpenCode and navigates to a session.
2. User runs `telegram.bind`.
3. Plugin validates config.
4. Plugin claims or refreshes bridge ownership lease.
5. Plugin stores current session ID as the bound session.
6. Plugin starts Telegram polling.
7. Plugin optionally posts a channel message indicating the bridge is online.

### 2. Prompt Flow

1. Telegram channel receives `/tp <prompt>`.
2. Poller validates channel and parses command.
3. Controller verifies bridge is online and session is bound.
4. Prompt is queued.
5. Plugin injects the prompt into the bound OpenCode session.
6. Event tracker watches assistant progress and completion.
7. Summary formatter builds a compact response.
8. Plugin posts summary to Telegram channel.

### 3. Permission Flow

1. Bound session emits `permission.asked`.
2. Plugin posts a Telegram message with request ID and available actions.
3. User sends one of:
   - `/tp approve <id>`
   - `/tp approve-always <id>`
   - `/tp deny <id>`
4. Plugin replies to OpenCode permission API immediately.
5. Plugin posts a short confirmation to the channel.

### 4. Shutdown Flow

1. OpenCode TUI exits normally or via `Ctrl+C`.
2. Plugin lifecycle dispose fires.
3. Poller stops.
4. Lease heartbeat stops.
5. Ownership is released.
6. Plugin may post a final offline message if shutdown path still has network access.
7. If process dies uncleanly, stale lease recovery allows a future console to reclaim ownership.

## Edge Cases That Must Be Covered

- Duplicate Telegram updates after reconnect
- Bot receiving its own summary posts
- Two OpenCode consoles trying to bind the same bridge
- OpenCode exit during an in-flight Telegram request
- Permission prompt arriving while a queued prompt is active
- Assistant finishing with no useful text output
- Telegram message length limits
- Session unbound while poller is still running

## Suggested Implementation Order

1. Scaffold package, TypeScript config, and TUI entrypoint
2. Build config and persistent state store
3. Build Telegram API client and poller
4. Build session binding and ownership lease
5. Build prompt injection and queueing
6. Build OpenCode event tracking and response correlation
7. Build permission handling from Telegram
8. Build summary formatting
9. Build shutdown and stale-owner recovery
10. Write README and manual verification steps

## Manual Verification Plan

1. Bind plugin to a live OpenCode session.
2. Send a simple `/tp` prompt from the configured Telegram channel.
3. Confirm summary arrives back in the channel.
4. Send a prompt that triggers a permission request.
5. Approve from Telegram and confirm execution continues.
6. Deny from Telegram and confirm execution aborts cleanly.
7. Kill OpenCode with `Ctrl+C` and confirm bridge stops.
8. Reopen OpenCode and confirm stale-owner reclaim behavior works as designed.
