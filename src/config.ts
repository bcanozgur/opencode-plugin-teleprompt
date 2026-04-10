import type { BridgeConfig } from "./types.js";

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`${name} must be one of: true, false, 1, 0, yes, no`);
}

export function loadConfig(): BridgeConfig {
  const botToken = process.env.OPENCODE_TELEGRAM_BOT_TOKEN?.trim();
  const channelID = process.env.OPENCODE_TELEGRAM_CHANNEL_ID?.trim();
  const prefix = "/tp";
  return {
    botToken: botToken || "",
    channelID: channelID || "",
    prefix,
    pollTimeoutSec: readNumber("OPENCODE_TELEGRAM_POLL_TIMEOUT_SEC", 30),
    heartbeatMs: readNumber("OPENCODE_TELEGRAM_HEARTBEAT_MS", 10_000),
    leaseTtlMs: readNumber("OPENCODE_TELEGRAM_LEASE_TTL_MS", 30_000),
    summaryMaxChars: readNumber("OPENCODE_TELEGRAM_SUMMARY_MAX_CHARS", 1_200),
    onlineNotice: readBoolean("OPENCODE_TELEGRAM_ONLINE_NOTICE", true),
    offlineNotice: readBoolean("OPENCODE_TELEGRAM_OFFLINE_NOTICE", true),
  };
}
