import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTelegramUpdate } from "../src/telegram/parser.js";
import type {
  TelegramCallbackQuery,
  TelegramChannelPost,
  TelegramUpdate,
} from "../src/types.js";

const CHANNEL_ID = "-1001234567890";

function post(text: string, messageID = 100): TelegramUpdate {
  return {
    update_id: 1,
    channel_post: {
      message_id: messageID,
      date: 0,
      chat: { id: CHANNEL_ID, type: "channel" },
      text,
    },
  };
}

function callback(data: string, messageID = 200, id = "cb_1"): TelegramUpdate {
  const query: TelegramCallbackQuery = {
    id,
    from: { id: 1, is_bot: false, first_name: "Tester" },
    chat_instance: "ci",
    data,
    message: {
      message_id: messageID,
      date: 0,
      chat: { id: CHANNEL_ID, type: "channel" },
      text: "ignored",
    },
  };
  return { update_id: 2, callback_query: query };
}

test("parser treats non-slash channel posts as direct prompts", () => {
  const parsed = parseTelegramUpdate(post("hello world"), CHANNEL_ID, "/tp");
  assert.ok(parsed && !("callbackQueryID" in parsed));
  if (parsed && !("callbackQueryID" in parsed)) {
    assert.equal(parsed.command.kind, "prompt");
    assert.equal(parsed.command.prompt, "hello world");
  }
});

test("parser routes /status, /queue, /context, /health, /reclaim to their commands", () => {
  for (const [text, kind] of [
    ["/status", "status"],
    ["/queue", "queue"],
    ["/context", "context"],
    ["/health", "health"],
    ["/reclaim", "reclaim"],
    ["/who", "who"],
    ["/history", "history"],
    ["/last-error", "last-error"],
    ["/version", "version"],
  ] as const) {
    const parsed = parseTelegramUpdate(post(text), CHANNEL_ID, "/tp");
    assert.ok(parsed, `expected ${text} to parse`);
    if (parsed && !("callbackQueryID" in parsed)) {
      assert.equal(parsed.command.kind, kind);
    }
  }
});

test("parser routes /approve and /deny text commands to permission action", () => {
  const approve = parseTelegramUpdate(
    post("/approve req_1"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(approve && !("callbackQueryID" in approve));
  if (approve && !("callbackQueryID" in approve)) {
    assert.equal(approve.command.kind, "permission");
    if (approve.command.kind === "permission") {
      assert.equal(approve.command.action, "once");
      assert.equal(approve.command.requestID, "req_1");
    }
  }
  const deny = parseTelegramUpdate(
    post("/deny req_1"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(deny && !("callbackQueryID" in deny));
  if (deny && !("callbackQueryID" in deny)) {
    assert.equal(deny.command.kind, "permission");
    if (deny.command.kind === "permission") {
      assert.equal(deny.command.action, "reject");
    }
  }
});

test("parser routes /qreply text command to question reply with answers", () => {
  const parsed = parseTelegramUpdate(
    post("/qreply q_xyz\n0:Cats|Dogs\n1:Fish"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(parsed && !("callbackQueryID" in parsed));
  if (parsed && !("callbackQueryID" in parsed)) {
    assert.equal(parsed.command.kind, "question");
    if (parsed.command.kind === "question") {
      assert.equal(parsed.command.action, "reply");
      assert.equal(parsed.command.requestID, "q_xyz");
      assert.equal(parsed.command.answers?.length, 2);
      assert.deepEqual(parsed.command.answers?.[0].labels, ["Cats", "Dogs"]);
    }
  }
});

test("parser routes /qreject text command to question reject", () => {
  const parsed = parseTelegramUpdate(
    post("/qreject q_xyz"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(parsed && !("callbackQueryID" in parsed));
  if (parsed && !("callbackQueryID" in parsed)) {
    assert.equal(parsed.command.kind, "question");
    if (parsed.command.kind === "question") {
      assert.equal(parsed.command.action, "reject");
    }
  }
});

test("parser routes permission callback to a ParsedCallbackQuery with permission command", () => {
  const parsed = parseTelegramUpdate(
    callback("p:o:req_1", 200, "cb_1"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(parsed);
  if (parsed && "callbackQueryID" in parsed) {
    assert.equal(parsed.callbackQueryID, "cb_1");
    assert.equal(parsed.command.kind, "permission");
    if (parsed.command.kind === "permission") {
      assert.equal(parsed.command.action, "once");
      assert.equal(parsed.command.requestID, "req_1");
    }
  } else {
    assert.fail("expected ParsedCallbackQuery");
  }
});

test("parser routes question-answer callback to a question reply command with indices", () => {
  const parsed = parseTelegramUpdate(
    callback("q:a:q_xyz:0:1", 200, "cb_2"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(parsed);
  if (parsed && "callbackQueryID" in parsed) {
    assert.equal(parsed.command.kind, "question");
    if (parsed.command.kind === "question") {
      assert.equal(parsed.command.action, "reply");
      assert.equal(parsed.command.questionIndex, 0);
      assert.equal(parsed.command.optionIndex, 1);
    }
  } else {
    assert.fail("expected ParsedCallbackQuery");
  }
});

test("parser routes question-toggle and confirm callbacks", () => {
  const toggle = parseTelegramUpdate(
    callback("q:t:q_xyz:0:2", 200, "cb_3"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(toggle);
  if (toggle && "callbackQueryID" in toggle) {
    assert.equal(toggle.command.kind, "question");
    if (toggle.command.kind === "question") {
      assert.equal(toggle.command.action, "toggle");
      assert.equal(toggle.command.optionIndex, 2);
    }
  } else {
    assert.fail("expected ParsedCallbackQuery");
  }

  const confirm = parseTelegramUpdate(
    callback("q:c:q_xyz:0", 200, "cb_4"),
    CHANNEL_ID,
    "/tp",
  );
  assert.ok(confirm);
  if (confirm && "callbackQueryID" in confirm) {
    assert.equal(confirm.command.kind, "question");
    if (confirm.command.kind === "question") {
      assert.equal(confirm.command.action, "confirm");
    }
  } else {
    assert.fail("expected ParsedCallbackQuery");
  }
});

test("parser ignores callback_query from a different channel", () => {
  const query: TelegramCallbackQuery = {
    id: "cb_5",
    from: { id: 1 },
    data: "p:o:req_1",
    message: {
      message_id: 300,
      date: 0,
      chat: { id: "-100DIFFERENT", type: "channel" },
    },
  };
  const update: TelegramUpdate = { update_id: 5, callback_query: query };
  const parsed = parseTelegramUpdate(update, CHANNEL_ID, "/tp");
  assert.equal(parsed, undefined);
});

test("parser ignores text from a different channel", () => {
  const different: TelegramChannelPost = {
    message_id: 999,
    date: 0,
    chat: { id: "-100DIFFERENT", type: "channel" },
    text: "hello",
  };
  const parsed = parseTelegramUpdate(
    { update_id: 6, channel_post: different },
    CHANNEL_ID,
    "/tp",
  );
  assert.equal(parsed, undefined);
});
