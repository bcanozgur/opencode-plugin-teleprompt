export function createTelegramUserMessageID(updateID: number): string {
  return `tg-${updateID}`;
}

export async function submitPrompt(
  client: any,
  sessionID: string,
  prompt: string,
  updateID: number,
  model?: {
    providerID: string;
    modelID: string;
  },
): Promise<{ userMessageID: string }> {
  const userMessageID = createTelegramUserMessageID(updateID);
  await client.session.promptAsync({
    sessionID,
    messageID: userMessageID,
    ...(model ? { model } : {}),
    parts: [{ type: "text", text: prompt }],
  });
  return { userMessageID };
}
