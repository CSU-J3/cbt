// Temporary instrumentation for handoff 48 — measure page load breakdown.
// Wraps an async call and logs [perf] <label>: <ms>ms. Remove once the
// numbers are captured and the fix is shipped.

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[perf] ${label}: ${Math.round(performance.now() - t0)}ms`);
  }
}
