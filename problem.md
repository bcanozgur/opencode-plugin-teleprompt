# Problem Statement: OpenCode Teleprompt Bridge Issues

Based on recent testing, there are two major issues with the current implementation of the Telegram bridge that need to be addressed:

## 1. Infinite Agent Loop (Model Re-triggering)
After a prompt sent from Telegram completes, the OpenCode agent loop continues to re-trigger the model indefinitely. 
- **Symptoms:** The model keeps waking up and generating new thoughts (e.g., *"The user hasn't sent a new message. I already answered their question."*). 
- **Previous Attempt:** We added `session.abort()` after detecting completion to stop the loop. However, this only marks the current run as "interrupted" in the UI, and a new run immediately starts right after. The abort is not terminating the overall agent loop gracefully.
- **Root Cause Hypothesis:** Calling `session.promptAsync` might be putting the session into a continuous background-task mode, or our `abort()` call triggers a retry mechanism inside OpenCode instead of a clean stop. We need to find the correct API call to properly signal the end of a user turn without triggering endless follow-ups.

## 2. TUI Visual Clutter & Disconnected Chat Flow
Messages sent from Telegram do not render correctly in the OpenCode TUI.
- **Symptoms:** User messages sent via Telegram stack up at the bottom of the screen as disconnected/empty-looking blocks (e.g., just showing the text like "hi" or "nasılsın" without proper chat bubble formatting). Meanwhile, the assistant's responses (and endless thoughts) stack up at the top.
- **Expected Behavior:** The OpenCode UI should look exactly like a normal manual interaction: User Message -> Assistant Response -> User Message -> Assistant Response, cleanly alternating.
- **Root Cause Hypothesis:** The way `promptAsync` injects the `parts: [{ type: "text", text: prompt }]` might be bypassing the standard UI rendering path for chat messages. We might need to use a different endpoint (like appending a message directly to the session tree and triggering a standard run) or format the `parts` differently to ensure the TUI recognizes them as standard chat messages.

## Next Steps
To solve these, we need to:
1. Investigate the OpenCode SDK to see if there is a better alternative to `client.session.promptAsync` for simulating standard chat input (e.g., simulating a UI submit event or appending a message and requesting a standard generation).
2. Remove the `session.abort()` hack, as it causes the "interrupted" UI state and doesn't actually stop the loop.
3. Understand how the TUI renders chat history to ensure the messages we inject perfectly match the structure of messages typed directly into the OpenCode terminal.
