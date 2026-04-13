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

export const tui: TuiPlugin = async (
  api: TuiPluginApi,
  _options?: Record<string, unknown>,
) => {
  const config = loadConfig();
  const storePath = join(api.state.path.directory, ".opencode-telegram-bridge.json");
  const controller = new BridgeController(api, config, storePath);
  await controller.init();

  if (config.botToken && config.channelID) {
    setTimeout(() => {
      // DUMP DEV TOOL
      try {
        const fs = require('node:fs');
        const dump = {
          routeKeys: Object.keys(api.route || {}),
          apiKeys: Object.keys(api || {}),
          commandKeys: Object.keys(api.command || {}),
          uiKeys: Object.keys(api.ui || {}),
          hasNavigate: typeof (api as any).navigate,
          routeCurrent: api.route?.current
        };
        fs.writeFileSync(storePath + '.debug.json', JSON.stringify(dump, null, 2));
      } catch (e) {}

      void runSafe(api, async () => {
        const state = await controller.syncState();
        if (state.bound.status !== "online" || !state.bound.sessionID) {
          const sessionID = await controller.bindCurrent();
          return `Telegram bridge auto-bound to session ${sessionID}`;
        }
      });
    }, 500);
  }

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
          const sessionID = await controller.bindCurrent();
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
