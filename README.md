# opencode-plugin-teleprompt

TUI-scoped OpenCode plugin that binds a Telegram channel to one active OpenCode session.

## What It Does

- **Frictionless Chat Interface**: Type direct prompts (like `write a python function`) in your Telegram channel without any prefixes!
- **Direct Slash Commands**: Run administrative commands like `/status`, `/queue`, `/dc` or `/approve <id>` directly in the Telegram channel.
- **Backward Compatibility**: Fully supports old `/tp <prompt>` and `/tp:<command>` syntax out of the box.
- **Relays Permission Prompts**: Directly relays OpenCode permission requests and accepts direct `/approve`, `/approve-always`, and `/deny` replies.
- **Lease-based Owner Semantics**: Keeps single-owner bridge semantics across multiple OpenCode consoles.
- **Instant Ctrl+C Exit**: Stops event streams and cleans up instantly, ensuring no exit lags when shutting down OpenCode.

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
   - Send `/dc` in Telegram channel
   - Run `/tp:stop` in OpenCode
7. Use Telegram channel commands:
   - `<prompt>` (any message NOT starting with `/` is treated directly as a prompt!)
   - `/interrupt` (or `/tp:interrupt`)
   - `/queue` (or `/tp:queue`)
   - `/cancel <job_id|last>` (or `/tp:cancel <job_id|last>`)
   - `/retry` (or `/tp:retry`)
   - `/context` (or `/tp:context`)
   - `/compact` (or `/tp:compact`)
   - `/newsession` (or `/tp:newsession`)
   - `/reset-context` (or `/tp:reset-context`)
   - `/who` (or `/tp:who`)
   - `/health` (or `/tp:health`)
   - `/reclaim` (or `/tp:reclaim`)
   - `/history` (or `/tp:history`)
   - `/last-error` (or `/tp:last-error`)
   - `/model` (or `/tp:model`)
   - `/model fast` (or `/tp:model fast`)
   - `/model smart` (or `/tp:model smart`)
   - `/model max` (or `/tp:model max`)
   - `/model <provider>/<model>`
   - `/approve <request_id>`
   - `/approve-always <request_id>`
   - `/deny <request_id>`
   - `/status`
   - `/dc` (or `/tp:dc`)

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
5. Send `/status` from Telegram and confirm status response.
6. Send `test ping` and confirm lifecycle + summary reply.
7. Send `/dc` and confirm local input is unlocked in OpenCode.

## Telegram Live E2E Quick Checklist

1. Start OpenCode session and run `/tp:start`.
2. From Telegram channel, run `/status` and verify owner/session info.
3. Run `/model` and switch once with `/model fast` (or explicit provider/model).
4. Send `write a 1-line summary of this session` and verify:
   - `accepted` -> `running` -> `completed`
   - summary arrives as reply to the same Telegram message
5. Trigger a permissioned action prompt and verify:
   - plugin posts permission request with `request_id`
   - `/approve <request_id>` (or `/deny <request_id>`) is applied immediately
6. Send `/interrupt` during a long run and confirm graceful stop.
7. Send `/dc` and confirm disconnect/unlock behavior.

## Command Reference

### OpenCode Local Commands

- `/tp:start`: Bind teleprompt to the current OpenCode session and start Telegram polling.
- `/tp:start <bot_token> <channel_id>`: Bind with session-only credentials when env vars are not set.
- `/tp:credentials <bot_token> <channel_id>`: Store session-only credentials for the current runtime.
- `/tp:stop`: Unbind teleprompt, stop polling, and unlock local session input.
- `/tp:status`: Show current bridge status in OpenCode (session, owner, model, queue, permissions).

### Telegram Commands

- `<prompt>`: Any message not starting with `/` is queued directly as a prompt for the session.
- `/interrupt`: Abort the currently running remote prompt without disconnecting the bridge.
- `/queue`: Show active prompt and queued prompts.
- `/cancel <job_id|last>`: Remove a queued prompt by job ID, or remove the newest queued prompt with `last`.
- `/retry`: Re-queue the most recent prompt from prompt history.
- `/context`: Show compact session context (recent prompts, summaries, and changed files).
- `/compact`: Trigger session summarization/compaction for long-running sessions.
- `/newsession`: Create a new OpenCode session and switch teleprompt binding to it.
- `/reset-context`: Alias behavior for creating/switching to a fresh session context.
- `/who`: Show lease ownership details (current instance, lease owner, ownership state).
- `/health`: Show bridge health (lease age/staleness, poller/event stream status, queue stats).
- `/reclaim`: Try to reclaim bridge ownership for the current instance.
- `/history`: Show recent run history with status and short summaries.
- `/last-error`: Show the latest failed or interrupted run summary.
- `/model`: List available models by provider and show current model selection.
- `/model fast`: Select a model using the `fast` preset resolver.
- `/model smart`: Select a model using the `smart` preset resolver.
- `/model max`: Select a model using the `max` preset resolver.
- `/model <provider>/<model>`: Select an explicit provider/model for the bound session.
- `/approve <request_id>`: Approve a pending permission request once.
- `/approve-always <request_id>`: Approve a pending permission request and persist approval behavior when supported.
- `/deny <request_id>`: Reject a pending permission request.
- `/status`: Show bridge status from Telegram.
- `/dc`: Disconnect teleprompt from Telegram and unbind the current session.

## Shutdown Behavior

- On normal TUI disposal (`Ctrl+C`, clean exit), poller and heartbeat stop and lease is released **instantly** without hangs.
- On unclean termination, lease expires by TTL and next owner instance can reclaim.
