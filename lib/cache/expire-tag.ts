import { revalidateTag } from "next/cache";

/**
 * HO 706 — the one home for CBT's cache-flush freshness contract.
 *
 * Next 16 gave `revalidateTag` a required second argument, a cache-life
 * profile. The argument is not cosmetic: it decides whether a flush expires
 * entries immediately or hands out stale data while revalidating behind it.
 * Read off the runtime rather than the docs, at `next@16.3.4`
 * (`dist/server/web/spec-extension/revalidate.js`, verified by executing the
 * validator, not only by reading it):
 *
 *   - `:42-53` — with NO profile the call still runs, logs
 *     `"revalidateTag" without the second argument is now deprecated`, and
 *     takes the immediate-expiry path. That is Next 15's behaviour, deprecated.
 *   - `:219-222` — `if (!profile || cacheLife?.expire === 0)` marks the path
 *     revalidated for static AND dynamic. So `{ expire: 0 }` lands in the SAME
 *     branch as the old one-argument call: identical semantics, no warning.
 *   - a STRING profile such as `"max"` is stale-while-revalidate. The first
 *     request after a cron sync would serve STALE data and refresh behind it.
 *
 * **The ruling (HO 706, architect, non-fork): preserve today's semantics.**
 * Every CBT flush is immediate expiry, because every one of them runs at the
 * end of a cron that just wrote rows — the whole point is that the next reader
 * sees the write. Nothing in CBT uses `"use cache"`; the tags flushed here are
 * `unstable_cache` tags.
 *
 * **Changing this file changes every cron's freshness contract at once**, which
 * is exactly why it is one function and not 22 call sites. Moving CBT to
 * stale-while-revalidate is a one-line edit here and a Corey decision, not a
 * Code default — it would trade write-visibility for tail latency on the first
 * read after each sync.
 *
 * `{ expire: 0 }` validates: `validateAndNormalizeCacheLifeProfile` only throws
 * when `revalidate` and `expire` are both set and `revalidate > expire`, and
 * `normalizeCacheLifeValue` rejects `false`, non-numbers and non-finite values
 * but accepts `0`.
 */
export function expireTag(tag: string): void {
  revalidateTag(tag, { expire: 0 });
}
