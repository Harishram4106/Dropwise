# Dropwise demo: voice-over script with timings

The silent video runs **4:24.2**. Play it and read each line at its time; the pace assumed is about 2.3 words a second, so each line ends before the next starts.

| Time | Scene | You say |
|---|---|---|
| **0:00.6** | **1. The problem** | |
| 0:00.6 to 0:14.0 | | Every AI answer uses water, but nobody can see how much. Dropwise sits in front of the Bifrost AI gateway, estimates the water behind every request, and cuts the waste. |
| 0:14.4 to 0:20.9 | | Apps point at Dropwise instead of Bifrost, and nothing else in their code changes. |
| **0:21.4** | **2. Real requests, live** | |
| 0:24.9 to 0:31.0 | | This is the live Requests page. I'll send real requests through the gateway. |
| 0:31.3 to 0:39.1 | | An easy prompt, asked of the large Opus model. Dropwise routes it to the small Haiku model. |
| 0:40.5 to 0:46.9 | | Asking again is answered from the cache: no model call, and no new water. |
| 0:48.3 to 0:55.2 | | A time-sensitive question skips the cache on purpose, so it never serves a stale answer. |
| 0:56.6 to 1:01.7 | | A hard prompt stays on Opus, so quality isn't traded away. |
| 1:11.9 to 1:18.0 | | Every request gets a receipt: tokens measured, and water estimated as a range. |
| **1:23.2** | **3. The receipt** | |
| 1:23.2 to 1:31.9 | | The receipt names the exact registry version behind each factor, so every number can be traced to its source. |
| **1:32.3** | **4. Overview** | |
| 1:35.8 to 1:45.8 | | The Overview now shows what just happened. Measured numbers are labelled measured. Water is always an estimated range, with what it counts. |
| **1:46.7** | **5. Budgets** | |
| 1:50.2 to 2:00.2 | | Teams get daily water budgets, with an alert at eighty percent. The limit is soft: a team is flagged, but still served. |
| **2:00.5** | **6. Before and after** | |
| 2:04.0 to 2:14.4 | | Before and after: the same two hundred requests, with and without Dropwise. About twenty-two percent fewer model calls, and twenty-four percent fewer tokens. |
| 2:14.8 to 2:22.6 | | These answers are replayed recordings, so the cost shown is a what-if, and the page says so. |
| **2:22.9** | **7. Routing and cache** | |
| 2:26.5 to 2:44.2 | | Routing and cache. The classifier is plain rules, with no model call, so it adds almost no delay. Only prompts it is confident are easy go to the small model; a hard one like this stays on the large model. |
| **2:44.6** | **8. Time shifting** | |
| 2:48.1 to 2:54.2 | | A request can be deferred. I'll send one with a six hour deadline. |
| 2:57.8 to 3:11.2 | | Right now is already the lowest-demand hour in the profile, so Dropwise runs it at once, and says why. At a busier hour it would wait for the quiet one. |
| 3:11.6 to 3:21.1 | | The hourly profile is illustrative and says so. The water estimate doesn't change with the hour, so we claim no saving. |
| **3:21.5** | **9. Claim checker** | |
| 3:25.0 to 3:37.5 | | The claim checker splits a claim into parts and checks each against the registry: supported, overstated, understated, unsupported or outdated, with citations. This one uses a saved example. |
| **3:37.9** | **10. The registry** | |
| 3:41.4 to 3:46.6 | | Every factor has a source, a date and a signed version. |
| 3:53.4 to 4:08.6 | | Tavily finds newer sources, Haiku reads the figure, and code checks the quote is really in the source before an old figure is flagged stale. Nothing enters the registry until a person accepts it. |
| **4:08.9** | **11. Close** | |
| 4:11.9 to 4:22.3 | | Dropwise: measured where it can be, estimated where it must be, and honest about which is which. It is open source. Thank you. |

## Real requests made for this recording

```json
[
  {
    "label": "easy",
    "status": 200,
    "routed_to": "anthropic/claude-haiku-5-5",
    "cache": "miss",
    "water": "0.7415-1.0504; scope=direct_plus_indirect; estimated",
    "job_id": null,
    "answered": true
  },
  {
    "label": "easy again",
    "status": 200,
    "routed_to": "cache",
    "cache": "hit",
    "water": "0-0; scope=direct_plus_indirect; estimated",
    "job_id": null,
    "answered": true
  },
  {
    "label": "weather",
    "status": 200,
    "routed_to": "anthropic/claude-haiku-5-5",
    "cache": "bypass",
    "water": "0.845-1.197; scope=direct_plus_indirect; estimated",
    "job_id": null,
    "answered": true
  },
  {
    "label": "hard",
    "status": 200,
    "routed_to": "anthropic/claude-opus-5-5",
    "cache": "miss",
    "water": "3.5408-5.0161; scope=direct_plus_indirect; estimated",
    "job_id": null,
    "answered": true
  },
  {
    "label": "deferred",
    "status": 202,
    "routed_to": null,
    "cache": null,
    "water": null,
    "job_id": "job_3fb9ed7455d1473b",
    "answered": false
  }
]
```
