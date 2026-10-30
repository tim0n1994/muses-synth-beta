export async function poll<T>(
  operation: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest = await operation();
  while (!predicate(latest) && Date.now() < deadline) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
    latest = await operation();
  }
  if (!predicate(latest))
    throw new Error(`Condition was not met within ${timeoutMs}ms.`);
  return latest;
}
