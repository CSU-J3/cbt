import "dotenv/config";
import { runSync } from "../lib/sync";

// HO 790: one tick of the bill sync, with no deadline. It lists /bill/{congress}
// from the frontier in sync_state (bootstrapped from MAX(update_date) the first
// time), queues every entry, moves the frontier when the listing completes, and
// drains the live queue to empty. `--wide` adds the wide listing (the frontier
// less 48 hours, missing or behind at day precision); without it a bare run
// never lists wide. It never calls /api/sync, which runs the same function on
// its own schedule.
runSync({ wide: process.argv.includes("--wide") }).catch((err) => {
  console.error(err);
  process.exit(1);
});
