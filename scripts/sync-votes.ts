import "dotenv/config";
import { runVotesSync } from "../lib/votes-sync";

runVotesSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
