import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPermissionRequestMessage,
  formatQuestionRequestMessage,
  normalizeAnswers,
  rejectQuestion,
  replyPermission,
  replyQuestion,
  toPendingPermission,
  toPendingQuestion,
} from "../src/opencode/permissions.js";

test("toPendingPermission normalizes a permission.asked payload", () => {
  const pending = toPendingPermission({
    id: "perm_1",
    sessionID: "ses_1",
    permission: "bash",
    patterns: ["echo *"],
    metadata: { tool: "bash" },
  });
  assert.equal(pending.requestID, "perm_1");
  assert.equal(pending.sessionID, "ses_1");
  assert.equal(pending.permission, "bash");
  assert.deepEqual(pending.patterns, ["echo *"]);
  assert.equal(typeof pending.announcedAt, "number");
});

test("formatPermissionRequestMessage includes request_id and reply examples", () => {
  const pending = toPendingPermission({
    id: "perm_42",
    sessionID: "ses_1",
    permission: "edit",
    patterns: ["**/*.ts"],
    metadata: { tool: "edit" },
  });
  const text = formatPermissionRequestMessage("/tp", pending);
  assert.match(text, /request_id: perm_42/);
  assert.match(text, /\/approve perm_42/);
  assert.match(text, /\/deny perm_42/);
});

test("toPendingQuestion normalizes a question.asked payload", () => {
  const pending = toPendingQuestion({
    id: "q_1",
    sessionID: "ses_1",
    questions: [
      {
        question: "Pick a stack",
        header: "Stack",
        options: [
          { label: "TypeScript", description: "strict typed" },
          { label: "Python", description: "fast scripting" },
        ],
        multiple: false,
      },
    ],
    tool: { messageID: "msg_x", callID: "call_y" },
  });
  assert.equal(pending.requestID, "q_1");
  assert.equal(pending.questions[0].options[0].label, "TypeScript");
  assert.equal(pending.tool?.callID, "call_y");
});

test("formatQuestionRequestMessage shows the question, header, and options", () => {
  const pending = toPendingQuestion({
    id: "q_42",
    sessionID: "ses_1",
    questions: [
      {
        question: "Pick a language",
        header: "Lang",
        options: [
          { label: "TypeScript", description: "Strict typed JS" },
          { label: "Python", description: "Batteries included" },
        ],
      },
    ],
  });
  const text = formatQuestionRequestMessage(pending, 0);
  assert.match(text, /Pick a language/);
  assert.match(text, /\[Lang\]/);
  assert.match(text, /TypeScript/);
  assert.match(text, /Python/);
  assert.match(text, /\/ans q_42/);
});

test("normalizeAnswers filters unknown labels and aligns by questionIndex", () => {
  const pending = toPendingQuestion({
    id: "q_1",
    sessionID: "ses_1",
    questions: [
      {
        question: "Q1",
        header: "",
        options: [{ label: "A" }, { label: "B" }],
      },
      {
        question: "Q2",
        header: "",
        options: [{ label: "X" }, { label: "Y" }],
      },
    ],
  });
  const normalized = normalizeAnswers(pending, [
    { questionIndex: 0, labels: ["A", "BOGUS"] },
    { questionIndex: 1, labels: ["Y"] },
  ]);
  assert.deepEqual(normalized, [["A"], ["Y"]]);
});

test("normalizeAnswers returns empty arrays for unanswered questions", () => {
  const pending = toPendingQuestion({
    id: "q_1",
    sessionID: "ses_1",
    questions: [
      { question: "Q1", header: "", options: [{ label: "A" }] },
      { question: "Q2", header: "", options: [{ label: "X" }] },
    ],
  });
  const normalized = normalizeAnswers(pending, [
    { questionIndex: 0, labels: ["A"] },
  ]);
  assert.deepEqual(normalized, [["A"], []]);
});

test("replyPermission uses the v2 SDK client.permission.reply when available", async () => {
  const calls: unknown[] = [];
  const client = {
    permission: {
      reply: async (params: unknown) => {
        calls.push(params);
        return { ok: true };
      },
    },
  };
  await replyPermission(client as any, "ses_1", "req_1", "once", "/dir");
  assert.equal(calls.length, 1);
  const params = calls[0] as Record<string, unknown>;
  assert.equal(params.requestID, "req_1");
  assert.equal(params.reply, "once");
  assert.equal(params.directory, "/dir");
});

test("replyQuestion uses the v2 SDK client.question.reply when available", async () => {
  const calls: unknown[] = [];
  const client = {
    question: {
      reply: async (params: unknown) => {
        calls.push(params);
        return { ok: true };
      },
    },
  };
  await replyQuestion(client as any, "/dir", "q_1", [["A"], ["B"]]);
  assert.equal(calls.length, 1);
  const params = calls[0] as Record<string, unknown>;
  assert.equal(params.requestID, "q_1");
  assert.equal(params.directory, "/dir");
  assert.deepEqual(params.answers, [["A"], ["B"]]);
});

test("rejectQuestion uses the v2 SDK client.question.reject when available", async () => {
  const calls: unknown[] = [];
  const client = {
    question: {
      reject: async (params: unknown) => {
        calls.push(params);
        return { ok: true };
      },
    },
  };
  await rejectQuestion(client as any, "/dir", "q_1");
  assert.equal(calls.length, 1);
  const params = calls[0] as Record<string, unknown>;
  assert.equal(params.requestID, "q_1");
  assert.equal(params.directory, "/dir");
});

test("replyPermission throws when no SDK method is available", async () => {
  const client = {};
  await assert.rejects(
    () => replyPermission(client as any, "ses_1", "req_1", "once", "/dir"),
    /permission reply method/,
  );
});
