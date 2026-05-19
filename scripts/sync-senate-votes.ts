import "dotenv/config";
import { runSenateVotesSync } from "../lib/senate-votes-sync";

runSenateVotesSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
