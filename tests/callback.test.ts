import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionKeyboard,
  buildQuestionKeyboard,
  decodeCallbackData,
  decodeTextQuestionReject,
  decodeTextQuestionReply,
  encodePermissionCallback,
  encodeQuestionAnswer,
  encodeQuestionConfirm,
  encodeQuestionReject,
  encodeQuestionToggle,
  TELEGRAM_CALLBACK_DATA_MAX,
} from "../src/telegram/callback.js";

test("permission callback: encode round-trips and decodes to the right action", () => {
  for (const action of ["once", "always", "reject"] as const) {
    const data = encodePermissionCallback(action, "req_123");
    assert.equal(data.length <= TELEGRAM_CALLBACK_DATA_MAX, true);
    const decoded = decodeCallbackData(data);
    assert.equal(decoded.kind, "permission");
    if (decoded.kind === "permission") {
      assert.equal(decoded.action, action);
      assert.equal(decoded.requestID, "req_123");
    }
  }
});

test("question answer / reject / toggle / confirm callback round-trips", () => {
  const answerData = encodeQuestionAnswer("q_1", 0, 2);
  assert.deepEqual(decodeCallbackData(answerData), {
    kind: "question",
    action: "answer",
    requestID: "q_1",
    questionIndex: 0,
    optionIndex: 2,
  });

  const rejectData = encodeQuestionReject("q_2");
  assert.deepEqual(decodeCallbackData(rejectData), {
    kind: "question",
    action: "reject",
    requestID: "q_2",
  });

  const toggleData = encodeQuestionToggle("q_3", 1, 3);
  assert.deepEqual(decodeCallbackData(toggleData), {
    kind: "question",
    action: "toggle",
    requestID: "q_3",
    questionIndex: 1,
    optionIndex: 3,
  });

  const confirmData = encodeQuestionConfirm("q_4", 0);
  assert.deepEqual(decodeCallbackData(confirmData), {
    kind: "question",
    action: "confirm",
    requestID: "q_4",
    questionIndex: 0,
  });
});

test("callback data fits the Telegram 64-byte limit for realistic request IDs", () => {
  const requestID = "req_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 32 chars
  const answerData = encodeQuestionAnswer(requestID, 0, 9);
  assert.ok(
    answerData.length <= TELEGRAM_CALLBACK_DATA_MAX,
    `answerData length=${answerData.length} > 64`,
  );
  const toggleData = encodeQuestionToggle(requestID, 0, 9);
  assert.ok(
    toggleData.length <= TELEGRAM_CALLBACK_DATA_MAX,
    `toggleData length=${toggleData.length} > 64`,
  );
  const confirmData = encodeQuestionConfirm(requestID, 0);
  assert.ok(
    confirmData.length <= TELEGRAM_CALLBACK_DATA_MAX,
    `confirmData length=${confirmData.length} > 64`,
  );
});

test("permission keyboard exposes Approve once / Approve always / Deny buttons", () => {
  const keyboard = buildPermissionKeyboard("req_42");
  assert.equal(keyboard.inline_keyboard.length, 1);
  const row = keyboard.inline_keyboard[0];
  assert.equal(row.length, 3);
  assert.equal(row[0].text, "Approve once");
  assert.equal(row[1].text, "Approve always");
  assert.equal(row[2].text, "Deny");
  // All buttons have valid callback data
  for (const button of row) {
    assert.equal(button.callback_data.length <= TELEGRAM_CALLBACK_DATA_MAX, true);
    const decoded = decodeCallbackData(button.callback_data);
    assert.equal(decoded.kind, "permission");
  }
});

test("single-choice question keyboard has option buttons + reject row", () => {
  const keyboard = buildQuestionKeyboard({
    requestID: "q_42",
    questionIndex: 0,
    options: [
      { label: "Yes" },
      { label: "No" },
      { label: "Maybe" },
    ],
    selectedLabels: [],
    multiple: false,
  });
  // 3 option buttons + 1 reject row
  assert.equal(keyboard.inline_keyboard.length, 3);
  assert.equal(keyboard.inline_keyboard[2][0].text, "Skip / Reject");
});

test("multi-choice question keyboard toggles selection marks and adds Confirm row", () => {
  const keyboard = buildQuestionKeyboard({
    requestID: "q_99",
    questionIndex: 0,
    options: [
      { label: "Cats" },
      { label: "Dogs" },
      { label: "Fish" },
    ],
    selectedLabels: ["Cats"],
    multiple: true,
  });
  // options (1 row of 2 + 1 row of 1) + confirm row = 3 rows
  assert.equal(keyboard.inline_keyboard.length, 3);
  const confirmRow = keyboard.inline_keyboard[2];
  assert.equal(confirmRow.length, 2);
  assert.equal(confirmRow[0].text, "Confirm (1)");
  assert.equal(confirmRow[1].text, "Skip / Reject");
  // Cats button should have a check mark
  const catsButton = keyboard.inline_keyboard
    .flat()
    .find((b) => b.text.includes("Cats"));
  assert.ok(catsButton, "Cats button must exist");
  assert.match(catsButton.text, /✅/);
});

test("text /qreply decoder parses multi-question block", () => {
  const text = "/qreply q_xyz\n0:Cats|Dogs\n1:Fish";
  const decoded = decodeTextQuestionReply(text);
  assert.ok(decoded);
  assert.equal(decoded.requestID, "q_xyz");
  assert.equal(decoded.answers.length, 2);
  assert.deepEqual(decoded.answers[0].labels, ["Cats", "Dogs"]);
  assert.deepEqual(decoded.answers[1].labels, ["Fish"]);
});

test("text /qreject decoder parses a single request ID", () => {
  const decoded = decodeTextQuestionReject("/qreject q_xyz");
  assert.deepEqual(decoded, { requestID: "q_xyz" });
});

test("decoding unknown callback data returns unknown", () => {
  const decoded = decodeCallbackData("garbage");
  assert.equal(decoded.kind, "unknown");
});
