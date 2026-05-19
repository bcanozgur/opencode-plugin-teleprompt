export function createTelegramUserMessageID(updateID: number): string {
  return `msg_tg_${updateID}`;
}

export async function submitPrompt(
  client: any,
  sessionID: string,
  prompt: string,
  updateID: number,
  directory: string,
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

  // 1. If a specific model is selected, update the session model first
  if (model) {
    try {
      await client.session.update(
        {
          id: sessionID,
          directory,
          model,
        },
        {
          responseStyle: "data",
          throwOnError: true,
        },
      );
    } catch (err) {
      // Ignore model update errors or log them silently
    }
  }

  // 2. Clear the active TUI prompt
  try {
    await client.tui.clearPrompt(
      { directory },
      { responseStyle: "data", throwOnError: true },
    );
  } catch (err) {
    // Ignore clear errors
  }

  // 3. Append the prompt text to the TUI prompt buffer
  await client.tui.appendPrompt(
    {
      text: prompt,
      directory,
    },
    {
      responseStyle: "data",
      throwOnError: true,
    },
  );

  // 4. Submit the TUI prompt
  await client.tui.submitPrompt(
    { directory },
    {
      responseStyle: "data",
      throwOnError: true,
    },
  );

  return {
    userMessageID,
  };
}
