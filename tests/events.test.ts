import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionEventStream } from "../src/opencode/events.js";

type RecordedSubscribeCall = {
  parameters: unknown;
};

function createPushableStream(initial: any[] = []) {
  const queue: any[] = [...initial];
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
    throw(err: unknown): Promise<IteratorResult<any>> {
      closed = true;
      while (waiters.length) {
        const w = waiters.shift();
        w?.({ value: undefined, done: true });
      }
      return Promise.reject(err);
    },
  };
  (stream as any).__push = (event: any) => {
    if (waiters.length > 0) {
      const w = waiters.shift()!;
      w({ value: event, done: false });
    } else {
      queue.push(event);
    }
  };
  (stream as any).__close = () => {
    closed = true;
    while (waiters.length) {
      const w = waiters.shift();
      w?.({ value: undefined, done: true });
    }
  };
  return stream;
}

function createEventClient(opts?: { directory?: string; events?: any[]; questionList?: () => any }) {
  const stream = createPushableStream(opts?.events);
  const subscribeCalls: RecordedSubscribeCall[] = [];
  const questionListFn = opts?.questionList ?? (() => []);
  const client: any = {
    event: {
      subscribe: async (parameters: unknown) => {
        subscribeCalls.push({ parameters });
        return { stream };
      },
    },
    question: {
      list: async () => questionListFn(),
    },
    __stream: stream,
    __push: (event: any) => (stream as any).__push(event),
    __close: () => (stream as any).__close(),
    __subscribeCalls: subscribeCalls,
  };
  return client;
}

test("event.subscribe is called with directory at the parameters root (not under .query)", async () => {
  const client = createEventClient();
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
  });
  stream.start();
  // Give the loop a tick to subscribe.
  await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.equal(client.__subscribeCalls.length, 1);
  const parameters = client.__subscribeCalls[0].parameters as
    | { directory?: string; query?: { directory?: string } }
    | undefined;
  assert.ok(parameters, "subscribe should receive parameters");
  assert.equal(parameters!.directory, "/tmp/foo", "directory must be at parameters root");
  assert.equal(
    parameters!.query,
    undefined,
    "directory must NOT be nested under .query (SDK reads parameters.directory directly)",
  );
});

test("a real EventQuestionAsked payload is parsed and forwarded to onQuestionAsked with normalized questions", async () => {
  const client = createEventClient();
  const seen: Array<{ id: string; sessionID: string; questionCount: number; firstLabels: string[] }> = [];
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async (event) => {
      seen.push({
        id: event.id,
        sessionID: event.sessionID,
        questionCount: event.questions.length,
        firstLabels: event.questions[0]?.options.map((o) => o.label) ?? [],
      });
    },
  });
  stream.start();
  await new Promise((r) => setImmediate(r));
  client.__push({
    type: "question.asked",
    properties: {
      id: "q_42",
      sessionID: "ses_x",
      questions: [
        {
          question: "Which framework?",
          header: "Stack",
          options: [
            { label: "Next.js", description: "React-based" },
            { label: "Remix", description: "Loader-first" },
          ],
          multiple: false,
        },
      ],
    },
  });
  // Yield a few ticks for the loop to drain.
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.equal(seen.length, 1, "onQuestionAsked should fire once");
  assert.equal(seen[0].id, "q_42");
  assert.equal(seen[0].sessionID, "ses_x");
  assert.equal(seen[0].questionCount, 1);
  assert.deepEqual(seen[0].firstLabels, ["Next.js", "Remix"]);
});

test("EventQuestionAsked for a different sessionID is dropped", async () => {
  const client = createEventClient();
  let called = false;
  const stream = new SessionEventStream(client, "ses_me", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async () => {
      called = true;
    },
  });
  stream.start();
  await new Promise((r) => setImmediate(r));
  client.__push({
    type: "question.asked",
    properties: {
      id: "q_other",
      sessionID: "ses_someone_else",
      questions: [
        { question: "x", header: "h", options: [{ label: "A", description: "" }] },
      ],
    },
  });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.equal(called, false, "events for other sessions must be dropped");
});

test("question.replied is forwarded to onQuestionReplied with the requestID", async () => {
  const client = createEventClient();
  const seen: Array<{ id: string; sessionID: string }> = [];
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionReplied: async (event) => {
      seen.push({ id: event.id, sessionID: event.sessionID });
    },
  });
  stream.start();
  await new Promise((r) => setImmediate(r));
  client.__push({
    type: "question.replied",
    properties: {
      sessionID: "ses_x",
      requestID: "q_42",
      answers: [["Next.js"]],
    },
  });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { id: "q_42", sessionID: "ses_x" });
});

test("an exception thrown by a handler is isolated and does not kill the event stream", async () => {
  const client = createEventClient();
  const log: string[] = [];
  let secondCalled = false;
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {
      throw new Error("permission handler exploded");
    },
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async () => {
      secondCalled = true;
    },
  }, (msg) => log.push(msg));
  stream.start();
  await new Promise((r) => setImmediate(r));
  client.__push({
    type: "permission.asked",
    properties: {
      id: "perm_boom",
      sessionID: "ses_x",
      permission: "bash",
      patterns: ["echo *"],
    },
  });
  client.__push({
    type: "question.asked",
    properties: {
      id: "q_after",
      sessionID: "ses_x",
      questions: [
        { question: "x", header: "h", options: [{ label: "A", description: "" }] },
      ],
    },
  });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.equal(secondCalled, true, "the stream must keep consuming events after a handler error");
  assert.ok(
    log.some((m) => m.includes("handler error") && m.includes("permission.asked")),
    "the handler error must be logged",
  );
});

test("question.asked for a different sessionID is logged as a drop with both session IDs", async () => {
  const client = createEventClient();
  const log: string[] = [];
  const stream = new SessionEventStream(client, "ses_me", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async () => {},
  }, (msg) => log.push(msg));
  stream.start();
  await new Promise((r) => setImmediate(r));
  client.__push({
    type: "question.asked",
    properties: {
      id: "q_other",
      sessionID: "ses_someone_else",
      questions: [
        { question: "x", header: "h", options: [{ label: "A", description: "" }] },
      ],
    },
  });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.ok(
    log.some(
      (m) => m.includes("drop") && m.includes("question.asked") && m.includes("ses_someone_else"),
    ),
    "the drop should be logged with the foreign sessionID",
  );
});

test("a question tool call on message.part.updated with empty state.input.questions triggers polling fallback via question.list()", async () => {
  const match = {
    id: "q_req_42",
    sessionID: "ses_x",
    questions: [
      { question: "Which framework?", header: "Stack", options: [{ label: "Next.js", description: "React-based" }, { label: "Remix", description: "Loader-first" }] },
    ],
    tool: { messageID: "prt_qtool", callID: "call_42" },
  };
  const client = createEventClient({
    questionList: () => [match],
  });
  const seen: Array<{ id: string; questionCount: number; labels: string[] }> = [];
  const log: string[] = [];
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async (event) => {
      seen.push({
        id: event.id,
        questionCount: event.questions.length,
        labels: event.questions[0]?.options.map((o) => o.label) ?? [],
      });
    },
  }, (msg) => log.push(msg));
  stream.start();
  await new Promise((r) => setImmediate(r));

  // Push a question tool call WITHOUT state.input.questions — forces polling.
  client.__push({
    type: "message.part.updated",
    properties: {
      part: {
        id: "prt_qtool",
        sessionID: "ses_x",
        messageID: "msg_asst",
        type: "tool",
        tool: "question",
        callID: "call_42",
        state: { status: "running" },
      },
    },
  });

  // Wait for polling (250ms poll interval + margin)
  await new Promise((r) => setTimeout(r, 500));

  await stream.stop();
  assert.equal(seen.length, 1, "onQuestionAsked should fire via polling");
  assert.equal(seen[0].id, "q_req_42", "id should be the question request ID from question.list()");
  assert.equal(seen[0].questionCount, 1);
  assert.deepEqual(seen[0].labels, ["Next.js", "Remix"]);
  assert.ok(
    log.some((m) => m.includes("forward") && m.includes("question poll") && m.includes("call_42")),
    "forward log should mention the poll recovery",
  );
});

test("polling fallback does not fire for 'pending' status (only 'running')", async () => {
  let listCalls = 0;
  const client = createEventClient({
    questionList: () => { listCalls++; return []; },
  });
  const seen: Array<unknown> = [];
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async (event) => { seen.push(event); },
  });
  stream.start();
  await new Promise((r) => setImmediate(r));

  // Push a pending question tool call — must NOT trigger polling
  client.__push({
    type: "message.part.updated",
    properties: {
      part: {
        id: "prt_qtool",
        sessionID: "ses_x",
        messageID: "msg_asst",
        type: "tool",
        tool: "question",
        callID: "call_42",
        state: { status: "pending" },
      },
    },
  });

  await new Promise((r) => setTimeout(r, 100));
  await stream.stop();
  assert.equal(seen.length, 0, "onQuestionAsked should not fire for pending");
  assert.equal(listCalls, 0, "question.list() should not be called for pending status");
});

test("a question tool call on message.part.updated is forwarded to onQuestionAsked (OpenCode TUI surfaces questions as tool calls)", async () => {
  const client = createEventClient();
  const seen: Array<{ id: string; questionCount: number; labels: string[] }> = [];
  const log: string[] = [];
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async (event) => {
      seen.push({
        id: event.id,
        questionCount: event.questions.length,
        labels: event.questions[0]?.options.map((o) => o.label) ?? [],
      });
    },
  }, (msg) => log.push(msg));
  stream.start();
  await new Promise((r) => setImmediate(r));

  // First update: pending.
  client.__push({
    type: "message.part.updated",
    properties: {
      part: {
        id: "prt_qtool",
        sessionID: "ses_x",
        messageID: "msg_asst",
        type: "tool",
        tool: "question",
        callID: "call_42",
        state: {
          status: "pending",
          input: {
            questions: [
              {
                question: "Which framework?",
                header: "Stack",
                options: [
                  { label: "Next.js", description: "React-based" },
                  { label: "Remix", description: "Loader-first" },
                ],
              },
            ],
          },
        },
      },
    },
  });

  // Second update: still pending — must NOT fire onQuestionAsked twice.
  client.__push({
    type: "message.part.updated",
    properties: {
      part: {
        id: "prt_qtool",
        sessionID: "ses_x",
        messageID: "msg_asst",
        type: "tool",
        tool: "question",
        callID: "call_42",
        state: {
          status: "running",
          input: {
            questions: [
              {
                question: "Which framework?",
                header: "Stack",
                options: [
                  { label: "Next.js", description: "React-based" },
                  { label: "Remix", description: "Loader-first" },
                ],
              },
            ],
          },
        },
      },
    },
  });

  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.equal(seen.length, 1, "onQuestionAsked should fire exactly once across pending+running updates");
  assert.equal(seen[0].id, "call_42", "id should be the tool callID");
  assert.equal(seen[0].questionCount, 1);
  assert.deepEqual(seen[0].labels, ["Next.js", "Remix"]);
  assert.ok(
    log.some((m) => m.includes("forward") && m.includes("call_42")),
    "forward log should mention the callID",
  );
});

test("background question poller finds pending questions via question.list() (independent of SSE events)", async () => {
  const match = {
    id: "q_poll_99",
    sessionID: "ses_x",
    questions: [
      { question: "What color?", header: "Color", options: [{ label: "Red", description: "" }, { label: "Blue", description: "" }] },
    ],
    tool: { messageID: "msg_m", callID: "call_99" },
  };
  const client = createEventClient({
    questionList: () => [match],
  });
  const seen: Array<{ id: string; questionCount: number }> = [];
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async (event) => {
      seen.push({ id: event.id, questionCount: event.questions.length });
    },
  });
  stream.start();
  await new Promise((r) => setImmediate(r));

  // Trigger the poller directly without waiting for the interval timer.
  await stream.__test!.pollQuestionListOnce();

  await stream.stop();
  assert.equal(seen.length, 1, "background poller should find the question");
  assert.equal(seen[0].id, "q_poll_99", "should use the real question request ID");
  assert.equal(seen[0].questionCount, 1);
});

test("a non-question tool call is ignored", async () => {
  const client = createEventClient();
  const seen: Array<unknown> = [];
  const stream = new SessionEventStream(client, "ses_x", "/tmp/foo", {
    onAssistantCompleted: async () => {},
    onPermissionAsked: async () => {},
    onSessionError: async () => {},
    onUserMessage: async () => {},
    onQuestionAsked: async (event) => {
      seen.push(event);
    },
  });
  stream.start();
  await new Promise((r) => setImmediate(r));
  client.__push({
    type: "message.part.updated",
    properties: {
      part: {
        id: "prt_bash",
        sessionID: "ses_x",
        messageID: "msg_asst",
        type: "tool",
        tool: "bash",
        callID: "call_bash_1",
        state: { status: "running", input: { command: "ls" } },
      },
    },
  });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await stream.stop();
  assert.equal(seen.length, 0, "non-question tool calls must not trigger onQuestionAsked");
});
