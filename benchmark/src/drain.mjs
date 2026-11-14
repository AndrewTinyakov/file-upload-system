import { setTimeout as sleep } from 'node:timers/promises';

export async function waitForDrain(isEmpty, timeoutMs, clock = { now: Date.now, sleep }) {
  const deadline = clock.now() + timeoutMs;
  let emptySince = null;
  while (clock.now() < deadline) {
    if (await isEmpty()) {
      emptySince ??= clock.now();
      if (clock.now() < deadline && clock.now() - emptySince >= 6000) return true;
    } else emptySince = null;
    await clock.sleep(1000);
  }
  return false;
}
