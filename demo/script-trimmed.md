# Dropwise demo (trimmed): voice-over script with timings

The silent video runs **2:58.6**. Read each line at its time, at about 2.3 words a second: the line ends before the next begins. Scene times are exact; line times are targets.

| Time | Scene | You say |
|---|---|---|
| **0:00.3** | **1. The problem** | |
| 0:00.3 to 0:13.3 | | AI answers use water, and nobody can see how much. Dropwise sits in front of the Bifrost AI gateway, and uses Tavily search to keep each water figure sourced. |
| 0:13.5 to 0:18.7 | | Bifrost carries each request to the model; Tavily finds the evidence. |
| **0:18.5** | **2. Real requests, live** | |
| 0:19.4 to 0:22.8 | | Real requests: Dropwise, then Bifrost, then Claude. |
| 0:24.1 to 0:30.1 | | An easy prompt asked of Opus goes to Haiku, and Bifrost forwards it. |
| 0:31.4 to 0:37.0 | | Asked again, it comes from cache: no call to Bifrost at all. |
| 0:38.1 to 0:42.0 | | A time-sensitive question skips the cache on purpose. |
| 0:43.5 to 0:47.4 | | A hard prompt stays on Opus, through Bifrost. |
| 0:49.6 to 0:53.9 | | Every request gets a receipt: measured tokens, estimated water. |
| **0:55.9** | **3. The receipt** | |
| 0:56.0 to 1:03.7 | | Each receipt cites registry versions; the water factors were found with Tavily, so numbers trace to sources. |
| **1:04.0** | **4. Overview** | |
| 1:05.0 to 1:11.5 | | Measured numbers are labelled measured. Water is always an estimated range, from Tavily-found factors. |
| **1:12.1** | **5. Budgets** | |
| 1:13.0 to 1:20.8 | | Budgets are per team key, including Bifrost virtual keys. Alert at eighty percent; the limit is soft. |
| **1:21.0** | **6. Before and after** | |
| 1:22.0 to 1:29.7 | | Same two hundred requests, Bifrost alone versus Dropwise: about twenty-two percent fewer calls, twenty-four percent fewer tokens. |
| 1:29.9 to 1:36.9 | | The answers are replayed recordings, so cost is a what-if, and the page says so. |
| **1:37.4** | **7. Routing and cache** | |
| 1:38.4 to 1:48.0 | | The classifier is plain rules: no model call, no Tavily search. A hard prompt like this stays on the large model. |
| **1:49.2** | **8. Time shifting** | |
| 1:50.0 to 1:56.0 | | A request can be deferred. I'll send one with a six hour deadline. |
| 1:57.4 to 2:05.6 | | This hour is already the quietest, so it runs now through the same Bifrost path, and says why. |
| 2:08.1 to 2:16.3 | | The profile is illustrative, and the water estimate doesn't change with the hour, so we claim no saving. |
| **2:17.0** | **9. Claim checker** | |
| 2:18.0 to 2:27.9 | | Claim checker: each part is checked against the registry. This saved example uses the registry only; a Tavily key adds live sources. |
| **2:27.6** | **10. The registry** | |
| 2:28.5 to 2:35.0 | | Each factor has a source and a date. Tavily found two of the eight. |
| 2:35.7 to 2:47.8 | | Tavily finds newer sources, Haiku reads the figure through Bifrost, and code flags the old one stale. This replays a captured Tavily result; a person accepts changes. |
| **2:47.6** | **11. Close** | |
| 2:48.3 to 2:57.9 | | Dropwise: Bifrost carries the requests, Tavily keeps the numbers sourced, and all is labelled measured or estimated. Open source. Thank you. |
