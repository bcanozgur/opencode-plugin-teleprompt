import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramApi } from "../src/telegram/api.js";
import { BridgeController } from "../src/runtime/controller.js";
import { decodeCallbackData } from "../src/telegram/callback.js";
import type {
  BridgeConfig,
  BridgeStoreData,
  ParsedCallbackQuery,
  PendingQuestionAnswer,
  QuestionAskInput,
} from "../src/types.js";
import type { TuiPluginApi } from "../src/tui-types.js";

const CHANNEL_ID = "-1001234567890";
const SESSION_ID = "ses_test1";

type RecordedCall = {
  path: string;
  body: Record<string, unknown>;
};

type FakeEventStream = {
  events: any[];
  push: (event: any) => void;
  close: () => void;
};

function createFakeClient() {
  const calls: RecordedCall[] = [];
  const questionReplyCalls: Array<{ requestID: string; answers: string[][] }> = [];
  const questionRejectCalls: Array<{ requestID: string }> = [];
  const permissionReplyCalls: Array<{ requestID: string; reply: string }> = [];

  const stream: FakeEventStream = createEventStream();

  const client: any = {
    event: {
      subscribe: async () => ({ stream }),
    },
    session: {
      list: async () => ({ sessions: [] }),
      create: async () => ({ id: SESSION_ID }),
      get: async () => ({ id: SESSION_ID, title: "Test session" }),
      messages: async () => ({ messages: [] }),
      status: async () => ({ type: "idle" }),
      abort: async () => undefined,
    },
    permission: {
      reply: async (params: any) => {
        permissionReplyCalls.push({
          requestID: params.requestID,
          reply: params.reply,
        });
        return { ok: true };
      },
    },
    question: {
      reply: async (params: any) => {
        questionReplyCalls.push({
          requestID: params.requestID,
          answers: params.answers,
        });
        return { ok: true };
      },
      reject: async (params: any) => {
        questionRejectCalls.push({ requestID: params.requestID });
        return { ok: true };
      },
    },
    tui: {
      clearPrompt: async () => undefined,
      appendPrompt: async () => undefined,
      submitPrompt: async () => undefined,
    },
    __stream: stream,
    __calls: calls,
    __questionReplyCalls: questionReplyCalls,
    __questionRejectCalls: questionRejectCalls,
    __permissionReplyCalls: permissionReplyCalls,
  };
  return client;
}

function createEventStream(): FakeEventStream {
  const queue: any[] = [];
  const waiters: Array<(value: IteratorResult<any>) => void> = [];
  let closed = false;
  const stream: any = {
    [Symbol.asyncIterator]() {
      return stream;
    },
    next(): Promise<IteratorResult<any>> {
      if (queue.length > 0) {
        return Promise.resolve({ value: queue.shift(), done: false });
      }
      if (closed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    return(): Promise<IteratorResult<any>> {
      closed = true;
      while (waiters.length) {
        const w = waiters.shift();
        w?.({ value: undefined, done: true });
      }
      return Promise.resolve({ value: undefined, done: true });
    },
  };
  (stream as any).push = (event: any) => {
    if (waiters.length > 0) {
      const w = waiters.shift()!;
      w({ value: event, done: false });
    } else {
      queue.push(event);
    }
  };
  (stream as any).close = () => {
    closed = true;
    while (waiters.length) {
      const w = waiters.shift();
      w?.({ value: undefined, done: true });
    }
  };
  return stream as FakeEventStream;
}

function createFakeTelegramApi(): {
  api: TelegramApi;
  sent: RecordedCall[];
} {
  const sent: RecordedCall[] = [];
  const api = new TelegramApi("test-token", {
    postFn: async <T>(path: string, body: Record<string, unknown>) => {
      sent.push({ path, body });
      if (path === "/getUpdates") {
        return [] as unknown as T;
      }
      return { ok: true } as unknown as T;
    },
  });
  return { api, sent };
}

function createApi(client: any): TuiPluginApi {
  return {
    command: { register: () => () => {} },
    route: { current: { name: "session", params: { sessionID: SESSION_ID } } },
    ui: {
      toast: () => {},
      dialog: {
        replace: () => {},
        clear: () => {},
      },
      DialogPrompt: () => null,
    },
    lifecycle: { onDispose: () => () => {} },
    event: { on: () => () => {} },
    state: {
      path: { directory: "/tmp/test-teleprompt" },
      part: () => [],
    },
    client,
  } as TuiPluginApi;
}

function createConfig(): BridgeConfig {
  return {
    botToken: "test-token",
    channelID: CHANNEL_ID,
    prefix: "/tp",
    pollTimeoutSec: 30,
    heartbeatMs: 10_000,
    leaseTtlMs: 30_000,
    summaryMaxChars: 1_200,
    onlineNotice: false,
    offlineNotice: false,
  };
}

async function bootstrapController(opts: {
  storePath: string;
  client: any;
  instanceID: string;
  now?: number;
  telegram?: TelegramApi;
}) {
  const config = createConfig();
  const api = createApi(opts.client);
  const now = opts.now ?? 1_700_000_000_000;
  const controller = new BridgeController(
    api,
    config,
    opts.storePath,
    {
      now: () => now,
      randomID: () => opts.instanceID,
    },
    opts.telegram,
  );
  await controller.init();

  const bound: BridgeStoreData = {
    version: 1,
    pollingOffset: 0,
    lease: {
      ownerInstanceID: opts.instanceID,
      ownerHeartbeatAt: now,
    },
    bound: {
      sessionID: SESSION_ID,
      channelID: CHANNEL_ID,
      status: "online",
    },
    promptQueue: [],
    pendingPermissions: {},
    pendingQuestions: {},
    questionAnswers: {},
    promptHistory: [],
    recentPrompts: [],
    updatedAt: now,
  };
  await controller.__test.setState(bound);
  return controller;
}

function findSentMessageWithButton(
  sent: RecordedCall[],
  match: (body: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  for (const call of sent) {
    if (call.path === "/sendMessage" && match(call.body)) return call.body;
  }
  return undefined;
}

test("permission.asked sends a waiting-permission notice and a message with an inline keyboard", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram, sent } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });

    await controller.__test.onPermissionAsked({
      id: "perm_1",
      sessionID: SESSION_ID,
      permission: "bash",
      patterns: ["echo *"],
      metadata: { tool: "bash" },
    });

    const waitingCall = sent.find(
      (c) => c.path === "/sendMessage" && c.body.text === "waiting-permission",
    );
    assert.ok(waitingCall, "expected a waiting-permission notice");
    const keyboardCall = findSentMessageWithButton(
      sent,
      (body) => typeof body.reply_markup === "object",
    );
    assert.ok(keyboardCall, "expected a sendMessage with reply_markup");
    const markup = keyboardCall.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    assert.equal(markup.inline_keyboard.length, 1);
    const row = markup.inline_keyboard[0];
    assert.equal(row.length, 3);
    assert.equal(row[0].text, "Approve once");
    assert.equal(row[2].text, "Deny");
    const onceDecoded = decodeCallbackData(row[0].callback_data);
    assert.deepEqual(onceDecoded, {
      kind: "permission",
      action: "once",
      requestID: "perm_1",
    });

    const state = await controller.__test.syncState();
    assert.ok(state.pendingPermissions["perm_1"]);

    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("onPermissionAsked swallows Telegram API errors so a 4xx on the detail message still leaves the pending permission stored", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const sent: RecordedCall[] = [];
    const telegram = new TelegramApi("test-token", {
      postFn: async <T>(path: string, body: Record<string, unknown>) => {
        sent.push({ path, body });
        if (path === "/getUpdates") return [] as unknown as T;
        // Simulate a 4xx on the very first sendMessage (the "waiting-permission" notice).
        if (path === "/sendMessage" && sent.filter((c) => c.path === "/sendMessage").length === 1) {
          throw new Error("Telegram API HTTP 400: bad request: chat not found");
        }
        return { ok: true } as unknown as T;
      },
    });
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.onPermissionAsked({
      id: "perm_throw",
      sessionID: SESSION_ID,
      permission: "bash",
      patterns: ["echo *"],
      metadata: { tool: "bash" },
    });
    // The detail message should still have been attempted (Telegram may have been
    // temporarily unreachable) and the pending permission should be stored.
    const state = await controller.__test.syncState();
    assert.ok(
      state.pendingPermissions["perm_throw"],
      "pending permission must be stored even if the Telegram send fails",
    );
    const sendCount = sent.filter((c) => c.path === "/sendMessage").length;
    assert.ok(sendCount >= 1, "at least the waiting-permission call should have been attempted");
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("clicking the Approve-once button on a permission prompt calls client.permission.reply", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.onPermissionAsked({
      id: "perm_99",
      sessionID: SESSION_ID,
      permission: "edit",
      patterns: ["**/*.ts"],
      metadata: { tool: "edit" },
    });

    const callback: ParsedCallbackQuery = {
      updateID: 100,
      callbackQueryID: "cb_99",
      channelID: CHANNEL_ID,
      messageID: 555,
      rawData: "p:o:perm_99",
      command: {
        kind: "permission",
        action: "once",
        requestID: "perm_99",
      },
    };
    await controller.__test.handleTelegramCallback(callback);

    assert.equal(client.__permissionReplyCalls.length, 1);
    assert.deepEqual(client.__permissionReplyCalls[0], {
      requestID: "perm_99",
      reply: "once",
    });

    const state = await controller.__test.syncState();
    assert.equal(state.pendingPermissions["perm_99"], undefined);
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("question.asked relays each question as a Telegram message with an inline keyboard", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram, sent } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });

    const input: QuestionAskInput = {
      id: "q_42",
      sessionID: SESSION_ID,
      questions: [
        {
          question: "Which framework?",
          header: "Stack",
          options: [
            { label: "Next.js", description: "React-based" },
            { label: "Remix", description: "Loader-first" },
            { label: "SvelteKit", description: "Compiled" },
          ],
          multiple: false,
        },
      ],
    };
    await controller.__test.onQuestionAsked(input);

    const state = await controller.__test.syncState();
    assert.ok(state.pendingQuestions["q_42"]);
    assert.equal(state.pendingQuestions["q_42"].questions[0].options.length, 3);

    // waiting-question lifecycle message
    const waiting = sent.find(
      (c) => c.path === "/sendMessage" && c.body.text === "waiting-question",
    );
    assert.ok(waiting, "expected a waiting-question notice");
    // The question prompt must include an inline keyboard
    const questionCall = sent.find(
      (c) =>
        c.path === "/sendMessage" &&
        typeof c.body.text === "string" &&
        c.body.text.includes("Which framework?") &&
        typeof c.body.reply_markup === "object",
    );
    assert.ok(questionCall, "expected a question message with reply_markup");
    const markup = questionCall.body.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const allButtonTexts = markup.inline_keyboard.flat().map((b) => b.text);
    assert.ok(allButtonTexts.includes("Next.js"));
    assert.ok(allButtonTexts.includes("Remix"));
    assert.ok(allButtonTexts.includes("SvelteKit"));
    // Skip/Reject row must be present
    assert.ok(
      allButtonTexts.some((t) => t === "Skip / Reject"),
      "expected a Skip / Reject button",
    );

    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("clicking an option button on a single-choice question calls client.question.reply with the selected label", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.onQuestionAsked({
      id: "q_77",
      sessionID: SESSION_ID,
      questions: [
        {
          question: "Pick one",
          header: "",
          options: [
            { label: "A", description: "" },
            { label: "B", description: "" },
          ],
        },
      ],
    });

    const callback: ParsedCallbackQuery = {
      updateID: 200,
      callbackQueryID: "cb_77",
      channelID: CHANNEL_ID,
      messageID: 888,
      rawData: "q:a:q_77:0:1",
      command: {
        kind: "question",
        action: "reply",
        requestID: "q_77",
        questionIndex: 0,
        optionIndex: 1,
      },
    };
    await controller.__test.handleTelegramCallback(callback);

    assert.equal(client.__questionReplyCalls.length, 1);
    assert.equal(client.__questionReplyCalls[0].requestID, "q_77");
    assert.deepEqual(client.__questionReplyCalls[0].answers, [["B"]]);

    const state = await controller.__test.syncState();
    assert.equal(state.pendingQuestions["q_77"], undefined);
    assert.equal(state.questionAnswers["q_77"], undefined);
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("clicking the reject button on a question calls client.question.reject", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.onQuestionAsked({
      id: "q_rej",
      sessionID: SESSION_ID,
      questions: [
        { question: "?", header: "", options: [{ label: "X" }] },
      ],
    });
    const callback: ParsedCallbackQuery = {
      updateID: 300,
      callbackQueryID: "cb_rej",
      channelID: CHANNEL_ID,
      messageID: 999,
      rawData: "q:r:q_rej",
      command: {
        kind: "question",
        action: "reject",
        requestID: "q_rej",
      },
    };
    await controller.__test.handleTelegramCallback(callback);

    assert.equal(client.__questionRejectCalls.length, 1);
    assert.equal(client.__questionRejectCalls[0].requestID, "q_rej");

    const state = await controller.__test.syncState();
    assert.equal(state.pendingQuestions["q_rej"], undefined);
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("multi-choice toggle edits the keyboard, then confirm replies with all selected labels", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram, sent } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.onQuestionAsked({
      id: "q_multi",
      sessionID: SESSION_ID,
      questions: [
        {
          question: "Pick many",
          header: "Tags",
          options: [
            { label: "alpha" },
            { label: "beta" },
            { label: "gamma" },
          ],
          multiple: true,
        },
      ],
    });

    // 1. Toggle 'alpha' (index 0)
    await controller.__test.handleTelegramCallback({
      updateID: 400,
      callbackQueryID: "cb_t0",
      channelID: CHANNEL_ID,
      messageID: 1111,
      rawData: "q:t:q_multi:0:0",
      command: {
        kind: "question",
        action: "toggle",
        requestID: "q_multi",
        questionIndex: 0,
        optionIndex: 0,
      },
    });
    // 2. Toggle 'gamma' (index 2)
    await controller.__test.handleTelegramCallback({
      updateID: 401,
      callbackQueryID: "cb_t2",
      channelID: CHANNEL_ID,
      messageID: 1111,
      rawData: "q:t:q_multi:0:2",
      command: {
        kind: "question",
        action: "toggle",
        requestID: "q_multi",
        questionIndex: 0,
        optionIndex: 2,
      },
    });

    // The toggle handler should have edited the reply markup at least twice.
    const editCalls = sent.filter(
      (c) => c.path === "/editMessageReplyMarkup",
    );
    assert.ok(editCalls.length >= 2, "expected at least 2 editMessageReplyMarkup calls");
    // After toggling alpha + gamma, the keyboard for q_multi should show
    // both labels with check marks.
    const lastEdit = editCalls[editCalls.length - 1];
    const markup = lastEdit.body.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const allButtonTexts = markup.inline_keyboard.flat().map((b) => b.text);
    assert.ok(
      allButtonTexts.some((t) => t.includes("alpha") && t.includes("✅")),
      `expected alpha with check mark, got ${JSON.stringify(allButtonTexts)}`,
    );
    assert.ok(
      allButtonTexts.some((t) => t.includes("gamma") && t.includes("✅")),
      `expected gamma with check mark, got ${JSON.stringify(allButtonTexts)}`,
    );

    // 3. Confirm the selection
    await controller.__test.handleTelegramCallback({
      updateID: 402,
      callbackQueryID: "cb_c",
      channelID: CHANNEL_ID,
      messageID: 1111,
      rawData: "q:c:q_multi:0",
      command: {
        kind: "question",
        action: "confirm",
        requestID: "q_multi",
        questionIndex: 0,
      },
    });

    assert.equal(client.__questionReplyCalls.length, 1);
    assert.equal(client.__questionReplyCalls[0].requestID, "q_multi");
    const labels = client.__questionReplyCalls[0].answers[0];
    assert.deepEqual(
      [...labels].sort(),
      ["alpha", "gamma"],
    );
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("text-based /qreply command calls client.question.reply with the parsed answers", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.onQuestionAsked({
      id: "q_text",
      sessionID: SESSION_ID,
      questions: [
        { question: "Q1", header: "", options: [{ label: "A" }, { label: "B" }] },
      ],
    });
    await controller.__test.handleTelegramMessage({
      updateID: 500,
      messageID: 2222,
      channelID: CHANNEL_ID,
      rawText: "/qreply q_text\n0:A",
      command: {
        kind: "question",
        action: "reply",
        requestID: "q_text",
        answers: [{ questionIndex: 0, labels: ["A"] }] satisfies PendingQuestionAnswer[],
      },
    });
    assert.equal(client.__questionReplyCalls.length, 1);
    assert.deepEqual(client.__questionReplyCalls[0].answers, [["A"]]);
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("onQuestionReplied clears the pending question from the store", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.onQuestionAsked({
      id: "q_eve",
      sessionID: SESSION_ID,
      questions: [{ question: "?", header: "", options: [{ label: "X" }] }],
    });
    let state = await controller.__test.syncState();
    assert.ok(state.pendingQuestions["q_eve"]);
    await controller.__test.onQuestionReplied({
      id: "q_eve",
      sessionID: SESSION_ID,
    });
    state = await controller.__test.syncState();
    assert.equal(state.pendingQuestions["q_eve"], undefined);
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});

test("end-to-end: an EventQuestionAsked pushed on the SSE stream is forwarded to Telegram", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "teleprompt-test-"));
  const storePath = join(tmp, "store.json");
  try {
    const client = createFakeClient();
    const { api: telegram, sent } = createFakeTelegramApi();
    const controller = await bootstrapController({
      storePath,
      client,
      instanceID: "inst_1",
      telegram,
    });
    await controller.__test.startEventStream(SESSION_ID);
    // Give the loop time to subscribe and start iterating.
    await new Promise((r) => setTimeout(r, 20));
    // Push a real EventQuestionAsked payload onto the SSE stream.
    client.__stream.push({
      type: "question.asked",
      properties: {
        id: "q_e2e",
        sessionID: SESSION_ID,
        questions: [
          {
            question: "Pick a stack?",
            header: "Stack",
            options: [
              { label: "Next.js", description: "React-based" },
              { label: "SvelteKit", description: "Compiled" },
            ],
            multiple: false,
          },
        ],
      },
    });
    // Wait for the stream loop to dispatch and the safeSend path to write to Telegram.
    for (let i = 0; i < 50; i++) {
      if (sent.some((c) => c.path === "/sendMessage" && c.body.text === "waiting-question")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const waiting = sent.find(
      (c) => c.path === "/sendMessage" && c.body.text === "waiting-question",
    );
    assert.ok(waiting, "expected a waiting-question notice after SSE event");
    const questionCall = sent.find(
      (c) =>
        c.path === "/sendMessage" &&
        typeof c.body.text === "string" &&
        c.body.text.includes("Pick a stack?") &&
        typeof c.body.reply_markup === "object",
    );
    assert.ok(questionCall, "expected a question message with reply_markup");
    const state = await controller.__test.syncState();
    assert.ok(state.pendingQuestions["q_e2e"]);
    await controller.__test.onQuestionReplied({ id: "q_e2e", sessionID: SESSION_ID });
    await controller.__test.startEventStream(SESSION_ID); // no-op, just to ensure no leaks
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
});
