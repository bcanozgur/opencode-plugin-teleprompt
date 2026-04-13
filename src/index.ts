import { tui } from "./tui.js";
import type { Plugin } from "@opencode-ai/plugin";

const id = "opencode-plugin-teleprompt";

const server: Plugin = async () => ({});

export default { id, server };
export { id, server, tui };
