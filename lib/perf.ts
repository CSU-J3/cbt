// Temporary instrumentation for handoff 49 — measure remaining dashboard
// pages before deciding which fixes to ship. Same pattern as handoff 48;
// remove once the numbers are captured.

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[perf] ${label}: ${Math.round(performance.now() - t0)}ms`);
  }
}
