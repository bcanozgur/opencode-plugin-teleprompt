import type { TuiPluginApi } from "../tui-types.js";

export function getCurrentSessionID(api: TuiPluginApi): string {
  const route = api.route.current;
  if (route.name !== "session") {
    throw new Error("Open a session first, then run telegram.bind.");
  }
  const sessionID = route.params?.sessionID;
  if (!sessionID || typeof sessionID !== "string") {
    throw new Error("Current route does not contain a valid session ID.");
  }
  return sessionID;
}
