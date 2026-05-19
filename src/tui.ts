import fs from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { BridgeController } from "./runtime/controller.js";
import type { TuiPlugin, TuiPluginApi } from "./tui-types.js";
import { PLUGIN_VERSION } from "./version.js";

async function runSafe(
  api: TuiPluginApi,
  fn: () => Promise<string | void>,
): Promise<void> {
  try {
    const message = await fn();
    if (message) {
      api.ui.toast({
        variant: "success",
        message,
      });
    }
  } catch (error) {
    api.ui.toast({
      variant: "error",
      message: String(error),
    });
  }
}

function promptUser(
  api: TuiPluginApi,
  title: string,
  placeholder?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    api.ui.dialog.replace(
      () =>
        api.ui.DialogPrompt({
          title,
          placeholder,
          onConfirm: (val) => {
            if (settled) return;
            settled = true;
            api.ui.dialog.clear();
            resolve(val);
          },
          onCancel: () => {
            if (settled) return;
            settled = true;
            api.ui.dialog.clear();
            reject(new Error("Cancelled"));
          },
        }),
      () => {
        if (!settled) {
          settled = true;
          reject(new Error("Closed"));
        }
      },
    );
  });
}

export const tui: TuiPlugin = async (
  api: TuiPluginApi,
  _options?: Record<string, unknown>,
) => {
  const config = loadConfig();
  const storePath = join(api.state.path.directory, ".opencode-telegram-bridge.json");
  const controller = new BridgeController(api, config, storePath);
  await controller.init();

  setTimeout(() => {
    // DUMP DEV TOOL
    try {
      const c = api.client as any;
      const dump = {
        routeKeys: Object.keys(api.route || {}),
        apiKeys: Object.keys(api || {}),
        commandKeys: Object.keys(api.command || {}),
        uiKeys: Object.keys(api.ui || {}),
        hasNavigate: typeof (api as any).navigate,
        routeCurrent: api.route?.current,
        clientType: typeof c,
        clientKeys: c ? Object.keys(c).slice(0, 20) : [],
        sessionType: typeof c?.session,
        sessionKeys: c?.session ? Object.keys(c.session).slice(0, 20) : [],
        messagesMethodSrc: c?.session?.messages?.toString?.()?.slice(0, 500),
        promptAsyncMethodSrc: c?.session?.promptAsync?.toString?.()?.slice(0, 500),
        abortMethodSrc: c?.session?.abort?.toString?.()?.slice(0, 500),
        getMethodSrc: c?.session?.get?.toString?.()?.slice(0, 500),
        listMethodSrc: c?.session?.list?.toString?.()?.slice(0, 200),
        createMethodSrc: c?.session?.create?.toString?.()?.slice(0, 200),
        tuiAppendPromptSrc: c?.tui?.appendPrompt?.toString?.()?.slice(0, 500),
        tuiClearPromptSrc: c?.tui?.clearPrompt?.toString?.()?.slice(0, 500),
        tuiSubmitPromptSrc: c?.tui?.submitPrompt?.toString?.()?.slice(0, 500),
      };
      fs.writeFileSync(storePath + '.debug.json', JSON.stringify(dump, null, 2));
    } catch (e) {}
  }, 500);

  const unregister = api.command.register(() => [
    {
      title: "Teleprompt: Start",
      value: "/tp:start",
      description: "Activate Telegram bridge for current OpenCode session",
      category: "Teleprompt",
      slash: {
        name: "tp:start",
        aliases: ["telegram.bind"],
      },
      onSelect: () => {
        void runSafe(api, async () => {
          let botToken = config.botToken;
          let channelID = config.channelID;

          if (!botToken || !channelID) {
            try {
              if (!botToken) {
                botToken = await promptUser(api, "Telegram Bot Token", "e.g., 8776307514:AAHbgKGZrzJUM6T...");
                // Add a small delay for the UI rendering loop to settle before showing the next dialog
                await new Promise((res) => setTimeout(res, 200));
              }
              if (!channelID) {
                channelID = await promptUser(api, "Telegram Channel ID", "e.g., -1003902302579");
              }
            } catch (err) {
              api.ui.toast({
                variant: "info",
                message: "Telegram setup cancelled.",
              });
              return;
            }
          }

          const sessionID = await controller.bindCurrent({ botToken, channelID });
          return `Telegram bridge bound to session ${sessionID}`;
        });
      },
    },
    {
      title: "Teleprompt: Stop",
      value: "/tp:stop",
      description: "Disconnect Telegram bridge and unlock local input",
      category: "Teleprompt",
      slash: {
        name: "tp:stop",
        aliases: ["telegram.unbind"],
      },
      onSelect: () => {
        void runSafe(api, async () => {
          await controller.unbind();
          return "Telegram bridge unbound";
        });
      },
    },
    {
      title: "Teleprompt: Status",
      value: "/tp:status",
      description: "Show bridge status",
      category: "Teleprompt",
      slash: {
        name: "tp:status",
        aliases: ["telegram.status"],
      },
      onSelect: () => {
        void runSafe(api, async () => controller.statusLine());
      },
    },
    {
      title: "Teleprompt: Credentials",
      value: "/tp:credentials",
      description: "Set session-only Telegram credentials",
      category: "Teleprompt",
      slash: {
        name: "tp:credentials",
        aliases: ["telegram.credentials"],
      },
      onSelect: () => {
        api.ui.toast({
          variant: "info",
          message:
            "Usage: /tp:credentials <bot_token> <channel_id> then /tp:start",
        });
      },
    },
    {
      title: "Teleprompt: Version",
      value: "/tp:version",
      description: "Show the loaded Teleprompt plugin version",
      category: "Teleprompt",
      slash: {
        name: "tp:version",
        aliases: ["telegram.version"],
      },
      onSelect: () => {
        api.ui.toast({
          variant: "info",
          message: `opencode-plugin-teleprompt ${PLUGIN_VERSION}`,
        });
      },
    },
  ]);

  const unsubscribeTuiCommand = api.event.on("tui.command.execute", (event) => {
    void controller.handleLocalTuiCommand(event.properties.command);
  });

  api.lifecycle.onDispose(async () => {
    unsubscribeTuiCommand();
    unregister();
    await controller.shutdown();
  });
};
