// HO 754 legs: lets a tsx script call lib/queries.ts's cached readers outside Next.
// `unstable_cache` throws with no incremental cache (the Next runtime's), so this
// resolve hook maps `next/cache` to a stub whose unstable_cache returns the function
// itself: the reader's own SQL runs, uncached. Loaded only by
// scripts/diagnostic/committee-meetings-queries-754.ts via `node --import`; never by
// the app, the build, or anything deployed.
import { registerHooks } from "node:module";

const stub =
  "data:text/javascript," +
  encodeURIComponent(
    "export const unstable_cache = (fn) => fn; export const revalidateTag = () => {}; export const expireTag = () => {}; export const unstable_expireTag = () => {}; export const unstable_noStore = () => {}; export default {};",
  );

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/cache" || specifier === "next/cache.js") return { url: stub, format: "module", shortCircuit: true };
    return next(specifier, context);
  },
});
