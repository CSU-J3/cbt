import "dotenv/config";
import {
  generateDashboardLead,
  writeDashboardLead,
} from "../lib/dashboard-lead";

async function main() {
  const text = await generateDashboardLead();
  console.log("Generated lead:\n");
  console.log(text);
  console.log("\nWriting to DB...");
  await writeDashboardLead(text);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
