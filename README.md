# opencode-plugin-teleprompt

TUI-scoped OpenCode plugin that binds a Telegram channel to one active OpenCode session.

## What It Does

- Polls a strict Telegram channel for `/tp` commands
- Injects `/tp <prompt>` into the currently bound OpenCode session
- Sends summary-only response messages back to the same channel
- Relays OpenCode permission prompts and accepts Telegram `approve`, `approve-always`, `deny`
- Keeps single-owner bridge semantics across multiple OpenCode consoles

## V1 Limits

- Single strict channel
- Single active bound session
- Summary-only output (no full transcript)
- No auto-bind on startup

## Requirements

- Telegram bot token
- Bot must be an admin in the target channel
- Telegram credentials can be provided either:
  - via env vars (`OPENCODE_TELEGRAM_BOT_TOKEN`, `OPENCODE_TELEGRAM_CHANNEL_ID`)
  - or at runtime with `/tp:start <bot_token> <channel_id>` or `/tp:credentials <bot_token> <channel_id>`

Optional:

- `OPENCODE_TELEGRAM_POLL_TIMEOUT_SEC` (default: `30`)
- `OPENCODE_TELEGRAM_HEARTBEAT_MS` (default: `10000`)
- `OPENCODE_TELEGRAM_LEASE_TTL_MS` (default: `30000`)
- `OPENCODE_TELEGRAM_SUMMARY_MAX_CHARS` (default: `1200`)
- `OPENCODE_TELEGRAM_ONLINE_NOTICE` (`true`/`false`, default: `true`)
- `OPENCODE_TELEGRAM_OFFLINE_NOTICE` (`true`/`false`, default: `true`)

## Install And Build

```bash
npm install
npm run build
```

## Install In OpenCode (npm package)

Add this plugin package name into your OpenCode config:

`opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-teleprompt"]
}
```

OpenCode installs npm plugins automatically at startup.

## Activation And Use

1. Publish this package to npm.
2. Add package name to `opencode.json` as shown above.
3. Open a session in OpenCode TUI.
4. Run `/tp:start` in OpenCode to activate teleprompt for the current session.
   - If env vars are missing, run `/tp:start <bot_token> <channel_id>` once (or `/tp:credentials <bot_token> <channel_id>` then `/tp:start`).
   - Runtime credentials are session-only and are cleared on plugin/session shutdown.
5. While teleprompt is active, local prompt input is locked for that session.
6. Disconnect options:
   - Press `Esc` twice in a row in OpenCode
   - Send `/tp:dc` in Telegram channel
   - Run `/tp:stop` in OpenCode
7. Use Telegram channel commands:
   - `/tp <prompt>`
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
   - `/tp approve <request_id>`
   - `/tp approve-always <request_id>`
   - `/tp deny <request_id>`
   - `/tp status`
   - `/tp:dc`

During remote runs, teleprompt posts lifecycle updates (`accepted`, `queued`, `running`, `waiting-permission`, `completed`, `failed`) and result summaries are sent as replies to the originating Telegram message for clear correlation.

## Publish And Install Verification

### npm Publish Preparation

1. Run release validation locally:
   - `npm run verify:release`
2. Validate npm auth/account:
   - `npm whoami`
3. Publish:
   - `npm publish`

`prepublishOnly` is enabled and will run release verification automatically before publishing.

### Clean-Machine Install Checklist

1. On a clean machine, create `opencode.json` with:
   - `"plugin": ["opencode-plugin-teleprompt"]`
2. Set required env vars:
   - `OPENCODE_TELEGRAM_BOT_TOKEN`
   - `OPENCODE_TELEGRAM_CHANNEL_ID`
3. Start OpenCode and ensure plugin loads without startup errors.
4. Open one session, run `/tp:start`, verify bridge binds.
5. Send `/tp status` from Telegram and confirm status response.
6. Send `/tp test ping` and confirm lifecycle + summary reply.
7. Send `/tp:dc` and confirm local input is unlocked in OpenCode.

## Telegram Live E2E Quick Checklist

1. Start OpenCode session and run `/tp:start`.
2. From Telegram channel, run `/tp status` and verify owner/session info.
3. Run `/tp:model` and switch once with `/tp:model fast` (or explicit provider/model).
4. Send `/tp write a 1-line summary of this session` and verify:
   - `accepted` -> `running` -> `completed`
   - summary arrives as reply to the same Telegram message
5. Trigger a permissioned action prompt and verify:
   - plugin posts permission request with `request_id`
   - `/tp approve <request_id>` (or `/tp deny <request_id>`) is applied immediately
6. Send `/tp:interrupt` during a long run and confirm graceful stop.
7. Send `/tp:dc` and confirm disconnect/unlock behavior.

## Command Reference

### OpenCode Local Commands

- `/tp:start`: Bind teleprompt to the current OpenCode session and start Telegram polling.
- `/tp:start <bot_token> <channel_id>`: Bind with session-only credentials when env vars are not set.
- `/tp:credentials <bot_token> <channel_id>`: Store session-only credentials for the current runtime.
- `/tp:stop`: Unbind teleprompt, stop polling, and unlock local session input.
- `/tp:status`: Show current bridge status in OpenCode (session, owner, model, queue, permissions).

### Telegram Commands

- `/tp <prompt>`: Queue a new prompt for the currently bound session.
- `/tp:interrupt`: Abort the currently running remote prompt without disconnecting the bridge.
- `/tp:queue`: Show active prompt and queued prompts.
- `/tp:cancel <job_id|last>`: Remove a queued prompt by job ID, or remove the newest queued prompt with `last`.
- `/tp:retry`: Re-queue the most recent prompt from prompt history.
- `/tp:context`: Show compact session context (recent prompts, summaries, and changed files).
- `/tp:compact`: Trigger session summarization/compaction for long-running sessions.
- `/tp:newsession`: Create a new OpenCode session and switch teleprompt binding to it.
- `/tp:reset-context`: Alias behavior for creating/switching to a fresh session context.
- `/tp:who`: Show lease ownership details (current instance, lease owner, ownership state).
- `/tp:health`: Show bridge health (lease age/staleness, poller/event stream status, queue stats).
- `/tp:reclaim`: Try to reclaim bridge ownership for the current instance.
- `/tp:history`: Show recent run history with status and short summaries.
- `/tp:last-error`: Show the latest failed or interrupted run summary.
- `/tp:model`: List available models by provider and show current model selection.
- `/tp:model fast`: Select a model using the `fast` preset resolver.
- `/tp:model smart`: Select a model using the `smart` preset resolver.
- `/tp:model max`: Select a model using the `max` preset resolver.
- `/tp:model <provider>/<model>`: Select an explicit provider/model for the bound session.
- `/tp approve <request_id>`: Approve a pending permission request once.
- `/tp approve-always <request_id>`: Approve a pending permission request and persist approval behavior when supported.
- `/tp deny <request_id>`: Reject a pending permission request.
- `/tp status`: Show bridge status from Telegram.
- `/tp:dc`: Disconnect teleprompt from Telegram and unbind the current session.

## Shutdown Behavior

- On normal TUI disposal (`Ctrl+C`, clean exit), poller and heartbeat stop and lease is released.
- On unclean termination, lease expires by TTL and next owner instance can reclaim.
