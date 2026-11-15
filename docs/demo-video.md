# Demo video: shot list (about 3 minutes)

Record the browser window at desktop size (Cmd+Shift+5 → "Record Selected Portion", microphone on). Keep the demo-calls terminal on a second window or a split. Reset the gateway first for a clean dashboard (see the README), and hard-refresh the browser (Cmd+Shift+R).

Run the live calls with `scripts/demo-calls.sh` (Enter runs each scene; about $0.03 at most).

| # | Time | Show | Say |
| --- | --- | --- | --- |
| 1 | 0:00 | Landing page, slow scroll through the hero | "AI answers use real water, but nobody can see how much. Dropwise sits in front of the Bifrost AI gateway, estimates the water behind every request, and cuts the waste." |
| 2 | 0:20 | Terminal: scenes 1–2 of `demo-calls.sh` (easy prompt, then repeat) | "An easy prompt asked of the large model goes to the small one. Asking again is answered from cache: no model call at all." |
| 3 | 0:45 | Terminal: scene 3 (weather), then scene 4 (hard prompt) | "Time-sensitive prompts skip the cache on purpose. A hard prompt stays on the large model, so quality isn't traded away." |
| 4 | 1:05 | Dashboard → Overview, then Requests; open one receipt | "Each request gets a receipt: tokens measured, water estimated as a range, and the exact registry version each factor came from." |
| 5 | 1:30 | Budgets | "Teams get daily water budgets, with an alert at 80%." |
| 6 | 1:40 | Before / after | "Same 200 requests with and without Dropwise: 22.5% fewer model calls, 24.1% fewer tokens. The answers are replayed recordings, and the cost is a what-if, not a bill." |
| 7 | 2:00 | Terminal: scene 5 (time shifting), then dashboard → Time shifting | "A request can be deferred. It runs at a lower-demand hour. The hourly profile is illustrative and the page says so; the water estimate doesn't change with the hour, so we claim no saving." |
| 8 | 2:20 | Registry page, then terminal: `cd intelligence && npm run registry -- demo-stale --live` | "Every factor has a source, a date and a signed version. Tavily found a newer 2024 report, Haiku read the figure out of it, and the code checked the quote and flagged the old figure stale." |
| 9 | 2:45 | Claims page: check "Each ChatGPT prompt uses a bottle of water" | "The claim checker splits a claim and compares each part to the registry." |
| 10 | 2:55 | Back to landing page footer | "Open source, honest about what is measured and what is estimated. Thank you." |

## Say these honestly

- Water numbers are **estimates, shown as ranges**.
- The benchmark answers were **replayed**; cost there is a **what-if**.
- The **quality check has not been run**.
- The **hourly profile is illustrative**.
- Three hard prompts still route to the small model (listed in the README).

## Before you press record

- [ ] Gateway reset, so Requests starts empty.
- [ ] `docker compose ps` shows all four services healthy.
- [ ] Browser zoom 100%, no other tabs or notifications visible.
- [ ] Do a dry run of `scripts/demo-calls.sh` without recording only if you accept a few cents and extra receipts (then reset again).
