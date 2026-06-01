// Shared transient-retry wrapper for Gemini calls (HO 160). The summarize path
// (HO 48/115) has long retried Gemini's documented transient codes — 429
// RESOURCE_EXHAUSTED and 503 UNAVAILABLE — but the logic lived inlined in
// runSummarize. The weekly-report path had no such retry, so a single 503
// killed an entire week's report (the 2026-06-01 failure). This module hoists
// the primitives so both paths share one definition of "transient" and one
// backoff loop; each caller passes its own backoff ladder.

// Gemini documents 429 (RESOURCE_EXHAUSTED) and 503 (UNAVAILABLE) as transient.
// Other 5xx codes typically indicate a non-retryable request-shape problem.
export function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|"code"\s*:\s*(429|503)/.test(
    msg,
  );
}

// Abortable sleep. Rejects with AbortError if the signal is (or becomes)
// aborted, so a caller's wall-clock timer can interrupt a pending backoff.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export interface GeminiRetryOpts {
  // One backoff delay per retry attempt. Length caps the number of retries:
  // [2000, 4000, 8000] => up to 3 retries after the initial try. Callers tune
  // this to their function ceiling (summarize uses 4 steps bounded by its 15s
  // per-bill AbortController; weekly-report uses 3 to stay under Vercel 60s).
  backoffMs: readonly number[];
  // Optional wall-clock guard. When aborted, no further retries are attempted
  // and a pending backoff sleep is interrupted — the underlying error is
  // re-thrown immediately for the caller to classify.
  signal?: AbortSignal;
  // Fired just before each backoff sleep, for the caller to log. attempt is
  // 0-based (0 = first retry); total = backoffMs.length.
  onRetry?: (info: {
    attempt: number;
    total: number;
    waitMs: number;
    error: Error;
  }) => void;
}

// Runs fn(), retrying only on transient Gemini errors per the backoff ladder.
// On exhaustion, abort, or a non-retryable error, the original error is
// re-thrown so the caller keeps full control of failure bookkeeping (deferral
// stamps, give-up counters, cron_runs error capture). Never swallows.
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  opts: GeminiRetryOpts,
): Promise<T> {
  const { backoffMs, signal, onRetry } = opts;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      // Only retry on transient API errors AND if the caller's timer hasn't
      // fired — once aborted, sleeping further would either reject immediately
      // or just stall the rest of the run.
      if (!signal?.aborted && isRetryable(e) && attempt < backoffMs.length) {
        const wait = backoffMs[attempt]!;
        onRetry?.({
          attempt,
          total: backoffMs.length,
          waitMs: wait,
          error: e as Error,
        });
        await sleep(wait, signal);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}
