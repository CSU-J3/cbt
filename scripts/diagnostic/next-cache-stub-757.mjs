// HO 757 legs: lets lib/queries.ts's cached readers run outside a Next server.
// unstable_cache needs Next's incremental cache ("Invariant: incrementalCache
// missing in unstable_cache"), so under `tsx --import` this resolve hook maps
// the bare specifier `next/cache` to a stub: unstable_cache is a passthrough
// and revalidateTag a no-op. They are the only two names lib/ imports from
// next/cache (lib/queries.ts, lib/cache/expire-tag.ts). The readers' SQL and
// row mapping run as written; only the cache layer, identical before and after
// HO 757, is skipped.
//   node <tsx cli> --import ./scripts/diagnostic/next-cache-stub-757.mjs <script>
import { register } from "node:module";
import { isMainThread } from "node:worker_threads";

const STUB =
  "data:text/javascript," +
  encodeURIComponent("export const unstable_cache = (fn) => fn;\nexport const revalidateTag = () => {};\n");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/cache") return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}

if (isMainThread) register(import.meta.url);
