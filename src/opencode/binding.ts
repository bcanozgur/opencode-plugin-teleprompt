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

export async function getCurrentOrCreateSessionID(
  api: TuiPluginApi,
  client: any,
): Promise<string> {
  const route = api.route.current;
  if (route.name === "session") {
    const sessionID = route.params?.sessionID;
    if (sessionID && typeof sessionID === "string") {
      return sessionID;
    }
  }

  const response = await client.session.create({
    responseStyle: "data",
    throwOnError: true,
  });

  // Try multiple common paths for session ID
  const sessionID =
    (response as any)?.id ??
    (response as any)?.data?.id ??
    (response as any)?.session?.id ??
    (response as any)?.session?.data?.id;

  if (!sessionID || typeof sessionID !== "string") {
    const responseKeys = response ? Object.keys(response).join(", ") : "null";
    const responseJson = JSON.stringify(response).slice(0, 150);
    throw new Error(
      `Could not create a new OpenCode session. Response keys: [${responseKeys}]. Body: ${responseJson}`,
    );
  }

  try {
    const route = api.route as any;
    // According to debug dump, api.route.navigate exists
    // Reverting to positional arguments as the object-based call caused a crash
    if (typeof route.navigate === "function") {
      route.navigate("session", { sessionID });
    } else if (typeof route.push === "function") {
      route.push({ name: "session", params: { sessionID } });
    } else if (typeof route.set === "function") {
      route.set({ name: "session", params: { sessionID } });
    } else if (typeof (api as any).navigate === "function") {
      (api as any).navigate("session", { sessionID });
    }
  } catch (err) {
    // Ignore routing errors as the session is already created
  }

  return sessionID;
}
