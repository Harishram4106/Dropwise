# Dropwise

Dropwise makes AI's water footprint measurable, sourced and controllable: a sidecar for the Bifrost gateway that estimates the water behind every AI request, cuts avoidable waste through routing, caching and budgets, and uses Tavily to keep every number it shows sourced and current.

**Demo video:** [Watch Dropwise on YouTube](https://youtu.be/qcdsdRbtRNA)

## Repo layout

| Path | Owner | What it is |
| --- | --- | --- |
| `contracts/` | All | JSON Schemas for the handoffs: registry entry, claim result, water receipt, route decision, quality report |
| `intelligence/` | A (Blockchain/AI) | Evidence Registry, claim checker, right-sizing classifier |
| `gateway/` | B (Backend) | Sidecar in front of Bifrost: right-sizing, cache, estimator, budgets, receipts API, before/after benchmark |
| `frontend/` | C (Frontend) | The landing page and the dashboard (Next.js): overview, requests and receipts, budgets, before/after, routing and cache, time shifting, claim checker, registry. It reads the gateway and the intelligence API, and falls back to saved demo data when they are down |
| `bifrost/` | All | Bifrost's provider config (the Anthropic key is only ever an environment reference) |
| `docker-compose.yml` | All | Runs everything: Bifrost, gateway, intelligence API and the frontend |

## Data contracts

The schemas in `contracts/` are the source of truth; change them together. Every number is a range (`low == high` when a source states one figure), and every water figure says what it counts:

- `direct_only`: on-site data-center cooling water
- `indirect_only`: water consumed generating the electricity
- `direct_plus_indirect`: both (lifecycle studies included)
- `unclear`: the source doesn't say

A receipt cites the exact registry entries it used as `factor_id@version_hash`, so any estimate can be traced back to its sources.

## Evidence Registry (`intelligence/`)

Requires Node 22.18 or newer (TypeScript runs natively, no build step).

```bash
cd intelligence
npm install
cp .env.example .env   # add TAVILY_API_KEY and the Bifrost settings
npm test
```

| Command | What it does |
| --- | --- |
| `npm run registry -- status` | Lists every factor with its range, freshness and verification; flags `STALE`, `AGING` and empty factors |
| `npm run registry -- refresh [factor_id…]` | Tavily search → candidate sentences → figure extraction via Bifrost → reconfirm, flag stale, or propose new entries |
| `npm run registry -- accept <factor_id> [index]` | Promotes a reviewed candidate from `registry/candidates.json` into the registry |
| `npm run registry -- publish` | Signs a new registry version (ed25519) chained to the previous one |
| `npm run registry -- check` | Verifies every published version: hashes, signatures and chain links |
| `npm run registry -- keygen` | Creates the signing key pair (public key committed, private key git-ignored) |
| `npm run registry -- rehash` | Recomputes freshness and hashes after a manual edit to `entries.json` |

### How it decides

- **Freshness** decays with source age (half-life two years). Age alone only marks a factor `AGING`.
- **Stale** means Tavily found a *newer* source, in the same unit, whose range doesn't overlap the entry's. The entry records `superseded_by` and the candidate waits for review.
- **No invented numbers.** The extractor only accepts a figure if the model's quote appears verbatim in the source text, and the value sits inside its own range.
- **Integrity without a blockchain.** Each entry carries a `version_hash`; each published version hashes all entries, links to the previous version's hash and is signed. Anyone with `registry/keys/registry.public.pem` can run `check`. Anchoring the hash on a testnet is a roadmap item.
- **Tavily credits.** Search results are cached on disk for seven days, and re-verification runs on demand or on a schedule, never per request.

### Current entries

Six reference figures were seeded by hand on 2026-11-08 and checked against their sources (`verified_by: manual`). They show why published numbers disagree: Google's 0.26 mL counts on-site water only, Mistral's 45 mL is a lifecycle figure, OpenAI's 0.32 mL has no stated scope, and the "bottle of water" claim comes from a modeled 10–50 mL per GPT-3 response. Two estimator factors were added on 2026-11-10 from Tavily searches and published in signed version 2:

- **On-site water use effectiveness (WUE): 0.27 L per kWh.** Microsoft's FY25 global average for its owned data centres, from its 2026 Environmental Sustainability Report. Amazon reports 0.12 L per kWh, but that counts water withdrawn per kWh of IT load, so we took the more cautious and better-matched figure.
- **Water per kWh of electricity: 4.52 L per kWh.** The US national average indirect water consumption for 2023, from the Lawrence Berkeley National Lab 2024 data-center report. It is US-only.

The third estimator factor, energy per 1k output tokens, has no entry yet: the sources found state energy per query or per long prompt, not per token. Until one does, the estimator can use the sourced per-prompt energy figures above (0.24 to 0.34 Wh).

### Stale-factor demo (demo step 4)

```bash
npm run registry -- demo-stale          # deterministic, offline
npm run registry -- demo-stale --live   # real Tavily search + Bifrost extraction; falls back if either is down
```

This is a real case, not a made-up one. Lawrence Berkeley National Laboratory's 2016 report put the water consumed per kWh of US electricity at **7.6 L**. Their 2024 report puts it at **4.52 L** (for 2023). The demo loads the 2016 figure into a demo copy of the factor (`registry/demo/stale-factor.json`, both quotes verbatim) and runs the same `reconcile()` a refresh uses. The newer source uses the same unit and its range doesn't overlap, so the entry turns `stale` with `superseded_by` pointing at the 2024 report. The signed registry is never changed by the demo; it already holds the 2024 figure.

#### Recording the live Tavily refresh (video scene)

The refresh works for real now: a Tavily search, Haiku extraction through Bifrost, then the same `reconcile()` the registry uses. Show it in this order (about 40 seconds):

1. **Terminal.** Run the live demo. The first line says `Stale-factor demo (live)`, not `(fixture)`:
   ```bash
   cd intelligence && npm run registry -- demo-stale --live
   ```
   It finishes in a few seconds when the Tavily search is cached (cache lasts 7 days, so a run you did earlier this week costs no Tavily credit), plus up to three small Haiku calls through Bifrost (well under a cent).
2. **Say:** "Tavily found a 2024 report. Haiku read the figure out of it. The code checked that the quote really is in the source, that the unit matches and that the ranges disagree. Only then is the old figure flagged."
3. **Dashboard, `/registry`.** Scroll to *Stale-factor demo* and press *Check for newer sources*. It shows the same case with the verbatim quote underneath. The *Waiting for review* section above it is where a found-but-unaccepted figure sits until a person accepts it.
4. **Be straight about the limits:** the button uses the captured result so the video never depends on the network; the terminal run is the live one. The signed registry is not changed by either.

If the network or Docker is down, `demo-stale` (without `--live`) gives the same case from the captured result, and the page says which it is showing.

The *Waiting for review* list is empty until a refresh finds a newer figure that disagrees, or a factor with no entry yet. The one factor with no entry, energy per 1k output tokens, was refreshed on 2026-11-13 and found no usable source (they state energy per query, not per token), so with the live API the list is empty, and in demo mode the page shows a labelled sample from the saved demo.

If a source gives no publication date, the date is read from its link (for example `/2024-12/`) and the candidate is marked *date read from the link*, so a reviewer checks it before accepting.

## Claim checker (`intelligence/src/claims/`)

```bash
npm run claim -- "One ChatGPT query uses a bottle of water"            # readable
npm run claim -- "One ChatGPT query uses a bottle of water" --json     # contract JSON
npm run claim -- "..." --offline                                       # force deterministic mode
```

1. **Split** the claim into atomic claims. With `EXTRACTION_MODEL` set, a model does this through Bifrost; any atomic claim that contains a number or unit not in the original is rejected and the rules splitter takes over. Without a model, rules split on clauses that each carry a figure, and the result is deterministic, which is how the demo stays safe offline.
2. **Parse** the figure and normalise it to mL or Wh per prompt: "a bottle" (500 mL), "five drops", "one fifteenth of a teaspoon", "0.000085 gallons", ranges, and "a bottle for 10–50 responses" (10–50 mL each).
3. **Classify** what the claim counts (cooling, electricity, lifecycle, unclear).
4. **Compare** with the sources for the claim's subject (ChatGPT, Gemini, Mistral…), or with all of them if no subject is named. With a Tavily key, figures found live are added alongside the registry.
5. **Verdict.** The model never decides it; the numbers do. `supported` means a current source agrees within 1.5x. `overstated` and `understated` mean the claim sits beyond every source by more than 1.5x. `outdated` means only superseded sources agree. `unsupported` means there's no figure, no per-prompt basis, or the figure falls between sources with none agreeing.

Every result records whether a model or rules split it, whether live sources were used, and the hash of the signed registry version it was checked against.

| Claim | Verdict |
| --- | --- |
| One ChatGPT query uses a bottle of water | overstated (10x the highest published estimate) |
| A Gemini prompt uses about five drops of water | supported (Google, 0.26 mL) |
| GPT-3 needs a 500ml bottle for 10–50 responses | supported (UC Riverside) |
| Every AI query uses a teaspoon of water | unsupported (between sources, none agree) |
| Each AI prompt uses 0.001 mL of water | understated (260x below the lowest) |

## Right-sizing classifier (`intelligence/src/routing/`)

```bash
npm run route -- "What is the capital of Australia?"      # small, cache: use
npm run route -- "Is 2^31 - 1 prime?"                     # large: maths
npm run route -- "What's the weather in Chennai today?"   # small, cache: bypass
```

For every request it returns a route decision (`contracts/route-decision.schema.json`) with two separate answers:

- **Tier.** `small` only when the prompt shows an easy-task signal (a short lookup, a unit conversion, simple arithmetic, a small rewrite, extraction or classification, a greeting) and **no** hard-task signal (code, maths, logic puzzles, multi-step word problems, analysis or design, long-form writing, legal or medical stakes, over 2,000 tokens of context, four or more user turns). Images and tools always stay large. Anything with no clear signal stays large. Being wrong in that direction only costs savings; the other direction costs answer quality.
- **Cache.** `bypass` when the answer is likely to change: relative time ("today", "last weekend"), "latest", the current holder of a role, prices, weather, news, scores, outages, or an event in this year or later. Quoted passages and code are ignored when deciding this, so "summarise: '…starting next month…'" can still be cached, and so can "who won the 1966 World Cup?".

It is rules only, with no model call and no Tavily call, because it runs on every request inside the gateway (about 60 µs per request on a laptop). B maps `tier` to a model in the routing rules and logs `signals` with the receipt. `minConfidence` (default 0.7, or `min_confidence` in the API body) is the knob: raising it to 0.85 sends only prompts with two easy signals to the small model.

### Quality evaluation set

`intelligence/eval/routing-set.json` has 53 labelled prompts: 27 easy, 18 hard and 8 time-sensitive, including traps in both directions (short but hard, long but easy, "live" and "current" used in their evergreen sense). Every evergreen item has a deterministic answer check: an expected number, phrase, pattern, choice or JSON fields, read from a final `Answer:` line where that matters. No model grades another model.

```bash
npm run eval -- routing    # offline: classifier vs labels
npm run eval -- quality    # through Bifrost: answer quality with and without right-sizing
```

**Routing (offline, measured 2026-11-08):** 96.2% tier accuracy, 60.4% of prompts routed small, **0 hard prompts sent small**, time-sensitivity recall 100% and precision 88.9%. The remaining misses are left in on purpose, all on the cautious side:

- A one-step linear equation stays large: anything that looks like maths does.
- "Is GitHub down right now?" stays large: it has no easy signal.
- "What does a stock price represent?" bypasses the cache needlessly.

The labels were written alongside the rules, so treat this as a sanity check, not a result.

**Quality (the number we report):** every checkable prompt is answered by both `SMALL_MODEL` and `LARGE_MODEL` through Bifrost (`anthropic/claude-haiku-5-5` and `anthropic/claude-opus-5-5`). There's no temperature setting, because current Claude models reject one, so two runs can differ slightly; the checks themselves are rule-based. The report gives the pass rate for all-large, routed and all-small, and saves to `eval/results/` along with the eval set's hash. The guard fails if routing loses more than 5 points against all-large (`--max-drop`). The risk plan's fallback then applies: turn routing off and rely on caching and budgets. This needs Bifrost running; it has not been run yet.

## Gateway sidecar (`gateway/`)

Dropwise runs as a sidecar in front of Bifrost rather than as a Go plugin inside it: the plan's named fallback, chosen so the gateway shares a language with the intelligence service. Apps point at the sidecar's OpenAI-compatible endpoint instead of Bifrost's; every request then goes app → Dropwise → Bifrost → provider.

```bash
cd gateway
cp .env.example .env
npm run serve        # http://localhost:8088, needs the intelligence API on :8787 and Bifrost on :8080
npm test             # end-to-end against the real classifier and registry, with a fake Bifrost
npm run bench        # before/after benchmark: prints the plan; add --yes to run it
```

For each `POST /v1/chat/completions`:

1. **Classify.** The intelligence API says small or large, and whether the prompt is time-sensitive.
2. **Route.** An easy prompt asked of `LARGE_MODEL` (`anthropic/claude-opus-5-5`) goes to `SMALL_MODEL` (`anthropic/claude-haiku-5-5`). Requests for any other model are never re-routed; `"model": "dropwise/auto"` lets the classifier pick either way. `ROUTING=off` is the quality guard's fallback.
3. **Cache.** A repeat prompt is answered from cache with no model call. Prompts match after normalizing case, whitespace and trailing punctuation: an exact-match cache, not an embedding one, because the only provider key is Anthropic's and it has no embeddings endpoint. Entries are kept per virtual key, so one team is never served another team's cached answer. Time-sensitive prompts always skip it, and so does every request when the classifier is unreachable.
4. **Forward** to Bifrost, passing `Authorization` and `x-bf-vk` through.
5. **Estimate.** `energy per prompt (0.24–0.34 Wh) × tokens ÷ 400 × water factor`, with 0.27 L/kWh on-site (direct) plus 4.52 L/kWh for the electricity (indirect). All four figures are read from the signed registry and cited as `factor_id@version_hash`. Two assumptions are stated on every receipt: energy scales linearly with length from a 400-token reference, and US averages apply because Anthropic doesn't disclose regions. The registry has no per-model energy figure, so routing changes cost and tokens but not the water estimate; only avoided calls (cache hits) lower it.
6. **Budget.** The high end of the range is added to the caller's virtual key (`x-dropwise-key`, else `x-bf-vk`, else `default`). `data/budgets.json` sets daily limits; a key raises an alert at 80% and is flagged at 100% but still served (soft limit).
7. **Receipt.** Stored in `data/receipts.jsonl`, pushed to `/events`, and summarized in response headers (`x-dropwise-request-id`, `-routed-to`, `-cache`, `-water-ml`, `-budget`). The shape is `contracts/water-receipt.schema.json`.

| Route | Returns |
| --- | --- |
| `POST /v1/chat/completions` | The provider's response (streaming passes through) |
| `GET /health` | Models, levers on or off, whether the intelligence API is reachable |
| `GET /receipts` | Newest first; `?limit=50&virtual_key=&cache=hit\|miss\|bypass\|skipped\|off` |
| `GET /receipts/:id` | One receipt |
| `GET /summary` | `measured` (requests, calls avoided, cache hits and bypasses, routed-small share, tokens saved, gateway latency p50/p95) and `estimated` (water with and without Dropwise); `?scope=` and `?virtual_key=` |
| `GET /budgets` | Every key's limit, usage range, percentage, status, and the alerts raised |
| `GET /events` | Server-sent events: `receipt`, `budget_alert` and `job` |
| `GET /benchmark/latest` | Latest before/after benchmark, or 404 before the first run |
| `GET /jobs`, `GET /jobs/profile`, `GET /jobs/:id`, `POST /jobs/:id/run` | Time shifting: deferred requests, the hourly profile, one job (its answer is in `result` once it has run), and run a scheduled job now |

### Time shifting (deferred requests)

Add `x-dropwise-defer: 6h` (or `90m`, `2h30m`, or an ISO deadline; at most 48 hours) to a request and it is queued instead of answered. The gateway picks the hour before the deadline with the lowest value in an **hourly profile** (`data/hourly-profile.json`, or `HOURLY_PROFILE_FILE`), or runs it now if now is already the best (ties go to the earliest, so a flat profile never delays anything). You get a `202` with a `job_id`, the scheduled time and the reason; at that time the request runs through the same path as any other (classify, route, cache, budget, receipt), and its answer is at `GET /jobs/:id`. The receipt carries a `deferred` block: the job, when it was scheduled and ran, and the profile's index at request time and at the run. `POST /jobs/:id/run` runs a job early (recorded as `run_early`). Requests without the header are never delayed; streaming can't be deferred; jobs survive a restart, and a job that was mid-run is run again.

```bash
curl localhost:8088/v1/chat/completions -H 'content-type: application/json' -H 'x-dropwise-key: team-batch' -H 'x-dropwise-defer: 6h' \
  -d '{"model":"anthropic/claude-opus-5-5","messages":[{"role":"user","content":"Summarize last week'"'"'s tickets"}]}'
```

- **The profile is yours to supply.** It is 24 relative values (1.0 is an average hour, lower is better) in one time zone, with `source` saying where they come from and `illustrative: true|false`. **The one that ships is an illustration (a daytime-peak shape), not measured data, and says so on the dashboard, in every job and on every receipt.** Replace it with real hourly figures for your provider's region before relying on a scheduling decision. With no profile file at all, deferred requests simply run straight away and say why.
- **What it does not claim.** The Evidence Registry has no hourly factor, so a request's water estimate is the same whatever hour it runs, and no water saving from shifting is claimed anywhere. Time shifting records and acts on the profile you gave it; whether the hours you chose are better is your data's claim, not Dropwise's.
- **Stored data.** Jobs are kept in `data/jobs.json` (git-ignored) while they wait, request included so they can run; once a job has run, its prompt and any authorization header are no longer kept. The API never returns a stored request.
- **Dashboard:** `/dashboard/schedule`: the 24-hour profile with every job on the hour it will run, the jobs table with "Run now", and the saved-snapshot demo.

### Before/after benchmark (demo step 2)

`npm run bench` sends one fixed workload twice: straight to Bifrost (without Dropwise), then through the gateway (with Dropwise). Both runs ask for `LARGE_MODEL` with the same system prompt, `max_tokens` 2048 and 4 requests in flight, as an unchanged app would.

- **Workload** (`gateway/bench/prompts.json`): 150 prompts an internal company assistant might get (75 easy, 60 hard, 15 time-sensitive), none taken from the eval set the classifier was tuned on. A seeded sequence sends each once and 50 of them a second time, word for word, after the first: 200 requests, 25% repeats. **The repeat share is an assumption about traffic, not a measurement; cache savings scale with it.**
- **Measured:** model calls, cache hits, time-sensitive bypasses, share of calls routed to the small model, tokens, latency, and Dropwise's own overhead per request (from the receipts, excluding the model call).
- **Estimated:** water, from measured tokens with the same registry factors the receipts use, and cost at list prices. Routing doesn't change the water estimate (no per-model energy figure), so water falls only through calls avoided and shorter answers; routing shows up in cost.
- Each run uses its own virtual key, so it starts with an empty cache. Turn off Bifrost's own cache plugin, if enabled, or the run without Dropwise gets cache hits too.

```bash
npm run bench                      # the plan: what the classifier would do, and the worst-case cost. Sends nothing.
npm run bench -- --limit 10 --yes  # a cheap check that Bifrost, the gateway and the key all work
npm run bench -- --yes             # the full 200 requests per run (refused if the worst case is over --max-usd; see below)
```

Results go to `gateway/data/benchmark/` (`latest.json` is served at `GET /benchmark/latest`; shape: `contracts/benchmark-report.schema.json`). A run stops after its first 3 requests fail, and retries rate limits and overload errors. The worst case for both full runs is about $16.50 (every answer at 2048 tokens on Claude Opus 5.5, nothing routed or cached); real answers are shorter.

**The plan, from the classifier alone (not results; no model was called):** of 200 requests, 45 would be cache hits and 155 model calls, 72 of those calls (46.5%) routed to the small model, and all 20 time-sensitive requests would skip the cache, with no evergreen prompt flagged. On these unseen prompts, 3 of the 60 hard prompts would be routed small: an "explain the complexity" code question that starts with "Convert", a tax question and a lease question, because "tax" and "lease" aren't high-stakes words to the classifier. 20 easy prompts stay on the large model: 18 because no rule matched (the cautious default) and 2 because a hard rule misfired (a time conversion read as a word problem, a book recommendation read as analysis). Both cost money, not answer quality.

**Results (run 2026-11-13, replayed answers; recorded once from Claude Haiku 5.5 for $0.029):** 200 requests per side, 0 errors, 0 retries, receipts for every Dropwise request (`gateway/data/benchmark/bench-2026-11-13T07-24-25-221Z.json`). Both sides asked for `claude-opus-5-5` at `max_tokens` 1024 with 8 requests in flight.

| | Without Dropwise | With Dropwise |
|---|---|---|
| Model calls (measured) | 200 | 155 (45 cache hits, 22.5%) |
| Time-sensitive requests that skipped the cache (measured) | – | 20 of 20, none answered from the cache |
| Routed to the small model (measured) | – | 72 of 155 calls (46.5%) |
| Tokens in + out (measured) | 89,939 | 68,250 (21,689 fewer, 24.1%) |
| Request latency p50 / p95, ms (measured, includes recorded model time) | 1,524 / 6,233 | 1,168 / 6,138 |
| Added by Dropwise per model call p50 / p95, ms (measured) | – | 3.1 / 6.4 |
| Water, direct + indirect (**estimated**) | 258–366 mL | 196–278 mL (avoided 62–88 mL) |
| Water, direct only (**estimated**) | 14.6–20.6 mL | 11.1–15.7 mL |
| Cost at list prices (**what-if**) | $1.58 | $0.99 |

**How to read it.** The 24.1% fewer tokens and the water reduction come from calls the cache avoided, because both sides get identical recorded answers; routing doesn't change tokens here, and (by design) doesn't change the water estimate either. Routing shows up only in the what-if cost, which prices Haiku's token counts at Opus rates for the 83 calls that stayed on the large model, so it assumes a large-model answer would be as long. The 25% repeat share is an assumption, so the cache numbers scale with it. 43 answers on each side were cut off at `max_tokens` 1024 (long answers from a model that always thinks first), so token totals for long answers are a lower bound. By kind of prompt: 55 of 100 easy prompts went small, **3 of 80 hard prompts went small** (the known classifier misses listed above), and all 20 time-sensitive prompts skipped the cache. Whether right-sizing kept answers as good was not measured.

#### The low-cost route: record once, replay for free

A live run spends API credit, and the benchmark's cache, routing and water numbers don't depend on what the model says, only on how long its answers are. So the benchmark can be run on recorded answers:

```bash
npm run bench:record                # plan only: 150 prompts, the most it could cost, nothing sent
npm run bench:record -- --yes       # records one Haiku answer per prompt through Bifrost; stops at --max-usd (default $0.40)
npm run bench:replay                # serves those answers on :8080, standing in for Bifrost (no key, no cost)
BIFROST_URL=http://localhost:8080 npm run serve   # the gateway, in another terminal
npm run bench                       # the benchmark; against a replay server it needs no --yes and spends nothing
```

- **Recording** sends each of the 150 unique prompts to `anthropic/claude-haiku-5-5` once (`max_tokens` 1024) and saves the answer, token counts and time to `gateway/bench/recordings.json`. The worst case is about $0.08, and a hard `--max-usd` limit stops it earlier; a stopped run resumes where it left off, and a run whose first 3 requests fail stops at once.
- **Replaying:** both benchmark runs ask for `LARGE_MODEL`, and whatever model a request names, the replay server returns that prompt's recorded answer. Routing, caching, budgets and the water estimate all run for real in the gateway; only the model's text and token counts are replayed. Both runs get identical answers, so "tokens saved" is purely what Dropwise avoided.
- **What this does and doesn't show.** The report carries `setup.replay` and says so in its notes, and the dashboard shows "Replayed answers". Latency includes the recorded model time. **Cost is a what-if:** the recorded (Haiku) token counts priced at the rates of the model that served each call, so a call kept on the large model is priced as if it had produced an answer of that length. The 3 hard prompts above would still be routed small. Whether right-sizing keeps answers as good was **not measured** on this route: the quality check below compares two models and needs live calls.
- **A live run is guarded too.** Without a replay server, `npm run bench` refuses to start if its worst case is over `--max-usd` (default $0.40) and stops mid-run if its estimated cost passes it, so a mistyped command can't spend $16.

**Answer quality (`npm run eval -- quality` in `intelligence/`): not run.** It answers the eval set with the large, routed and small models and compares pass rates, which needs live calls to both models and credit for the large one. Until it is run, the dashboard says "Quality check not run yet" and no quality number is claimed anywhere.

## Intelligence API (for the dashboard)

`npm run serve` starts it on `http://localhost:8787` (set `PORT` to change it, and `DASHBOARD_ORIGIN` to restrict CORS).

| Route | Returns |
| --- | --- |
| `GET /health` | `{ ok, model, live_sources }`, which tells you what's configured |
| `GET /registry` | Latest signed version: `{ version, published_at, registry_hash, entries }` with freshness recomputed for today |
| `GET /registry/candidates` | `{ groups }`: figures a refresh found that nobody has accepted yet, each beside what the signed registry holds, with its verbatim quote and the command that accepts it. Read-only |
| `GET /registry/:factor_id` | One registry entry, for the citation drawer |
| `POST /claims/check` | Body `{ "claim": "..." }` → a claim result (`contracts/claim-result.schema.json`) |
| `POST /route/classify` | An OpenAI chat request body (`messages`, optional `tools`) or `{ "prompt": "..." }` → a route decision |
| `GET /demo/stale-factor` | `{ mode, before, after, outcome, newer_source, explanation }` for the stale-factor demo; add `?live=1` to try a live refresh |
| `GET /eval/routing` | The offline routing eval above, recomputed |
| `GET /eval/quality` | The latest quality report (`contracts/quality-report.schema.json`), or 404 before the first run |

### Running it in Docker

`intelligence/Dockerfile` builds a ~235 MB image (Node 22 Alpine, no build step, no runtime dependencies) that starts the API on port 8787 with a `/health` healthcheck and runs as a non-root user. The image never contains secrets: `.dockerignore` excludes `.env` and the registry's private key, so keys come in as environment variables at run time.

```bash
cd intelligence
docker build -t dropwise-intelligence .
docker run --rm -p 8787:8787 --env-file .env dropwise-intelligence
```

Service for the root `docker-compose.yml` (rename `bifrost` to whatever B calls the gateway service):

```yaml
  intelligence:
    build: ./intelligence
    ports: ["8787:8787"]
    env_file: [./intelligence/.env]            # TAVILY_API_KEY, EXTRACTION_MODEL, SMALL_MODEL, LARGE_MODEL
    environment:
      BIFROST_URL: http://bifrost:8080         # the gateway's service name, not localhost
      DASHBOARD_ORIGIN: http://localhost:3000  # C's dashboard (Next.js)
    volumes:
      - ./intelligence/eval/results:/app/eval/results   # keep quality reports in the repo
    depends_on: [bifrost]
```

Without any keys the service still runs fully offline: the claim checker uses rules and the signed registry, the classifier needs no model, and the stale-factor demo uses its captured result. To run the quality eval inside compose: `docker compose run --rm intelligence npm run eval -- quality`. Run `registry refresh`, `accept` and `publish` on the host, because publishing needs the private key, which never goes into the image.

### Running everything (Docker, Bifrost included)

`docker-compose.yml` runs Bifrost, the gateway, the intelligence API and the dashboard together. Bifrost is the official `maximhq/bifrost` image (pinned by digest), configured by `bifrost/config.json`: the Anthropic provider with its key as an environment reference (`env.ANTHROPIC_API_KEY`), file-only mode, no dashboard.

```bash
# In your own terminal. The key is typed here and goes nowhere else: not a file, not the repo, not a chat.
read -s ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY     # paste the key, press Enter (nothing is echoed)
docker compose up --build                                 # Bifrost :8080, gateway :8088, intelligence :8787, dashboard :3000 (all localhost-only)
open http://localhost:3000                                # the landing page; the dashboard is at /dashboard
```

The dashboard needs nothing else: with the gateway down it shows saved demo data (and says so), and `?demo=1` on any dashboard URL forces that. Its backend addresses are build arguments (the browser reads them, so they are `localhost` URLs). Once the repo and the demo video exist, put their links on the landing page's buttons by setting `NEXT_PUBLIC_REPO_URL` and `NEXT_PUBLIC_VIDEO_URL` in your shell before `docker compose up --build`.

Only Bifrost receives the key. Check the chain without spending anything by sending a request with no key set: it should reach Anthropic and come back as a 401 `authentication_error` with `claude-haiku-5-5` as the resolved model for an easy prompt asked of Opus, which shows routing working:

```bash
curl -s localhost:8088/v1/chat/completions -H 'content-type: application/json' -H 'x-dropwise-key: team-search' \
  -d '{"model":"anthropic/claude-opus-5-5","max_tokens":16,"messages":[{"role":"user","content":"What is the capital of Canada?"}]}'
```

- **No key, no spend:** record once, then replay: `BIFROST_URL=http://replay:8080 docker compose --profile replay up --build gateway intelligence replay` (see the benchmark section; needs `gateway/bench/recordings.json`).
- **Bifrost logs two startup errors in file-only mode that don't affect these requests:** `governance plugin ... governance config is nil` and `auth middleware requires config store`. They only affect Bifrost's own virtual keys (`x-bf-vk`) and dashboard login, which this setup doesn't use; the gateway keeps its own budgets.
- **The key never touches an image.** The `.dockerignore` files exclude `.env`, and compose reads `ANTHROPIC_API_KEY` from your shell at start-up. To stop: `docker compose down`.

## Honesty rules

Water is always an estimate shown as a range with what it counts. We report only what the benchmark measures (calls, tokens, cache hits, routing share, latency) and never claim real-world litres saved.
