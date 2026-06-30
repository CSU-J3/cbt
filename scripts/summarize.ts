import "dotenv/config";
import { runSummarize, type SummarizeOptions } from "../lib/summarize-runner";
import { computeStage } from "../lib/enums";

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  return undefined;
}

async function main() {
  const limitFlag = getFlag("limit");
  const limit = limitFlag ? parseInt(limitFlag, 10) : undefined;
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    throw new Error(`invalid --limit: ${limitFlag}`);
  }

  const typesFlag = getFlag("types");
  const types = typesFlag
    ? typesFlag
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : undefined;

  // Manual runs default to unbounded so they can drain the full backlog.
  // The cron route opts into a per-tick cap via runSummarize({limit: 50}).
  const opts: SummarizeOptions = { limit: limit ?? 0 };
  if (types !== undefined) opts.types = types;
  const stats = await runSummarize(opts);

  console.log(`\ndone: ok=${stats.ok} fail=${stats.failed}`);
  console.log(
    `tokens: prompt=${stats.promptTokens} output=${stats.outputTokens} total=${stats.promptTokens + stats.outputTokens}`,
  );

  if (stats.samples.length > 0) {
    console.log(`\n--- sample outputs (${stats.samples.length}) ---`);
    for (const s of stats.samples) {
      console.log(`\n[${s.bill.id}] ${s.bill.title}`);
      console.log(`SUMMARY: ${s.result.summary}`);
      console.log(`TOPICS:  ${s.result.topics.join(", ")}`);
      // HO 386: the LLM no longer emits stage; show the deterministic stage the
      // runner actually writes (computeStage from latest_action_text).
      console.log(`STAGE:   ${computeStage(s.bill.latest_action_text)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
