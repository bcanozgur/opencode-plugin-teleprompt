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
): Promise<{
  userMessageID: string;
  assistantMessageID?: string;
  assistantParts?: ReadonlyArray<{ type: string; [key: string]: unknown }>;
}> {
  const userMessageID = createTelegramUserMessageID(updateID);
  const response = await client.session.prompt({
    path: {
      id: sessionID,
    },
    body: {
      messageID: userMessageID,
      ...(model ? { model } : {}),
      parts: [{ type: "text", text: prompt }],
    },
    responseStyle: "data",
    throwOnError: true,
  });

  const info = (response?.info || response?.data?.info) as { id?: string } | undefined;
  const parts = (response?.parts || response?.data?.parts) as
    | ReadonlyArray<{ type: string; [key: string]: unknown }>
    | undefined;

  return {
    userMessageID,
    assistantMessageID: typeof info?.id === "string" ? info.id : undefined,
    assistantParts: parts,
  };
}
