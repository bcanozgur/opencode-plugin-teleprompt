export type TuiCommand = {
  title: string;
  value: string;
  description?: string;
  category?: string;
  slash?: {
    name: string;
    aliases?: string[];
  };
  onSelect?: () => void;
};

export type TuiPluginApi = {
  command: {
    register: (cb: () => TuiCommand[]) => () => void;
  };
  route: {
    current:
      | {
          name: "session";
          params: {
            sessionID?: string;
          };
        }
      | {
          name: string;
          params?: Record<string, unknown>;
        };
  };
  ui: {
    toast: (input: {
      variant?: "info" | "success" | "warning" | "error";
      message: string;
    }) => void;
  };
  lifecycle: {
    onDispose: (fn: () => void | Promise<void>) => () => void;
  };
  event: {
    on: (
      type: "tui.command.execute",
      handler: (event: { type: "tui.command.execute"; properties: { command: string } }) => void,
    ) => () => void;
  };
  state: {
    path: {
      directory: string;
    };
    part: (messageID: string) => ReadonlyArray<{ type: string; [key: string]: unknown }>;
  };
  client: any;
};

export type TuiPlugin = (api: TuiPluginApi, options?: Record<string, unknown>) => Promise<void>;
