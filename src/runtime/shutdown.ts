export function createShutdownGuard() {
  let done = false;
  return async (fn: () => Promise<void>): Promise<void> => {
    if (done) return;
    done = true;
    await fn();
  };
}

