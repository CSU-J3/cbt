import "dotenv/config";
import { runSync } from "../lib/sync";

runSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
