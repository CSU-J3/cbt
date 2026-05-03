# CBT — Full Backfill Run

I enabled billing on the Gemini API key with $10 in credit. We can stay on `gemini-2.5-flash` (no need for Flash-Lite).

Update the throttle: paid tier on Flash is 1,000 RPM so the 13-second delay is overkill. Set `BATCH_SIZE=5`, `BATCH_DELAY_MS=2000` — gives ~150 RPM, well under the cap and polite to the API. The full 1,675 backfill should finish in ~10-15 minutes.

Then run the full backfill on all bills where `summary IS NULL`. When done, report:

- How many succeeded, how many failed
- Any topics that got dropped by the validator (those logs)
- 5 random sample summaries from across different bill types so I can spot-check
- Approximate token usage if you can pull it from the API responses

If anything fails repeatedly, stop and ask before retrying.
