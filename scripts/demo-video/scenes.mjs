// Records the Dropwise demo: a silent walk through the landing page and every dashboard page, with real requests
// sent through the gateway while the Requests page is on screen. Writes the frames, an encoder timeline, and the
// timed voice-over script (markdown + SRT) for you to read over the video.
//
//   node scenes.mjs <work-dir>        (Chrome must already be running with --remote-debugging-port=9333)
//
// Real model calls: 5 requests through the gateway (one Opus, the rest Haiku or cached), about $0.03 at most.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recorder, timeline } from "./recorder.mjs";

const work = process.argv[2];
if (!work) throw new Error("usage: node scenes.mjs <work-dir>");
mkdirSync(work, { recursive: true });
const GW = process.env.GATEWAY_URL || "http://localhost:8088";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// DRY=1: walk every page on saved demo data and send nothing to the gateway. Free; used to check selectors and timing.
const DRY = process.env.DRY === "1";

// ---- the real requests -------------------------------------------------------------------------------------------
const calls = [];
async function gw(label, prompt, { key = "team-search", defer, maxTokens = 1200 } = {}) {
  if (DRY) {
    await sleep(3000);
    return { label, dry: true };
  }
  const headers = { "content-type": "application/json", "x-dropwise-key": key };
  if (defer) headers["x-dropwise-defer"] = defer;
  const res = await fetch(`${GW}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "anthropic/claude-opus-5-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  const info = {
    label,
    status: res.status,
    routed_to: res.headers.get("x-dropwise-routed-to"),
    cache: res.headers.get("x-dropwise-cache"),
    water: res.headers.get("x-dropwise-water-ml"),
    job_id: body?.job_id ?? null,
    answered: Boolean(body?.choices?.[0]?.message?.content),
  };
  calls.push(info);
  console.log("call", JSON.stringify(info));
  if (res.status >= 400) throw new Error(`${label}: gateway answered ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return info;
}

const EASY = "Give me three tips for a good night's sleep.";
const WEATHER = "What's the weather like in Chennai right now?";
const HARD = "Is 2^31 - 1 prime? Prove it in a few lines.";
const DEFERRED = "Summarize why caching reduces energy use, in two sentences.";

// ---- narration: lines are marked as they begin; scenes wait for each line to finish at a calm pace --------------------
const markers = [];
let speakUntil = 0;
const words = (s) => s.trim().split(/\s+/).length;
const spoken = (s) => (words(s) / 2.3 + 0.4) * 1000;
const scene = (name) => markers.push({ at: Date.now(), kind: "scene", name });
const line = (text) => {
  markers.push({ at: Date.now(), kind: "line", text, ms: spoken(text) });
  speakUntil = Date.now() + spoken(text);
};
const finish = async () => {
  const left = speakUntil - Date.now();
  if (left > 0) await sleep(left);
  await sleep(350); // a breath between lines
};

// ---- the walk -----------------------------------------------------------------------------------------------------
const d = await recorder({ port: 9333, out: join(work, "frames"), label: "dw" });
if (DRY) {
  const nav = d.nav;
  d.nav = (path, settle) => nav(path.includes("demo=1") ? path : `${path}${path.includes("?") ? "&" : "?"}demo=1`, settle);
}
await d.nav("/", 3500);
const start = Date.now() + 600;
await d.start();
await sleep(600);

let failure = null;
try {
scene("1. The problem");
line("Every AI answer uses water, but nobody can see how much. Dropwise sits in front of the Bifrost AI gateway, estimates the water behind every request, and cuts the waste.");
await d.hold(6);
await d.scrollBy(850, 1800);
await d.hold(3);
await finish();
line("Apps point at Dropwise instead of Bifrost, and nothing else in their code changes.");
await d.scrollBy(900, 1800);
await d.hold(1.5);
await d.scrollBy(900, 1800);
await finish();

scene("2. Real requests, live");
await d.nav("/dashboard/requests", 3500);
line("This is the live Requests page. I'll send real requests through the gateway.");
await d.hold(1.5);
await finish();

line("An easy prompt, asked of the large Opus model. Dropwise routes it to the small Haiku model.");
await Promise.all([gw("easy", EASY), finish()]);
await d.hold(1);

line("Asking again is answered from the cache: no model call, and no new water.");
await Promise.all([gw("easy again", EASY), finish()]);
await d.hold(1);

line("A time-sensitive question skips the cache on purpose, so it never serves a stale answer.");
await Promise.all([gw("weather", WEATHER), finish()]);
await d.hold(1);

line("A hard prompt stays on Opus, so quality isn't traded away.");
await Promise.all([gw("hard", HARD), finish()]);
await d.hold(1);

await d.scrollBy(520, 1500);
line("Every request gets a receipt: tokens measured, and water estimated as a range.");
await d.hold(2.5);
await finish();
await d.click('tr[id^="req-"]');
await d.hold(3);

scene("3. The receipt");
line("The receipt names the exact registry version behind each factor, so every number can be traced to its source.");
await d.scrollBy(700, 1800);
await d.hold(2);
await d.scrollBy(700, 1800);
await finish();

scene("4. Overview");
await d.nav("/dashboard", 3500);
line("The Overview now shows what just happened. Measured numbers are labelled measured. Water is always an estimated range, with what it counts.");
await d.hold(4);
await d.scrollBy(850, 1800);
await d.hold(1.5);
await d.scrollBy(850, 1800);
await finish();

scene("5. Budgets");
await d.nav("/dashboard/budgets", 3500);
line("Teams get daily water budgets, with an alert at eighty percent. The limit is soft: a team is flagged, but still served.");
await d.hold(3);
await d.scrollBy(800, 1800);
await finish();

scene("6. Before and after");
await d.nav("/dashboard/benchmark", 3500);
line("Before and after: the same two hundred requests, with and without Dropwise. About twenty-two percent fewer model calls, and twenty-four percent fewer tokens.");
await d.hold(3);
await d.scrollBy(900, 1800);
await d.hold(1.5);
await finish();
line("These answers are replayed recordings, so the cost shown is a what-if, and the page says so.");
await d.scrollBy(900, 1800);
await d.hold(1.5);
await d.scrollBy(900, 1800);
await finish();

scene("7. Routing and cache");
await d.nav("/dashboard/routing", 3500);
line("Routing and cache. The classifier is plain rules, with no model call, so it adds almost no delay. Only prompts it is confident are easy go to the small model; a hard one like this stays on the large model.");
await d.hold(2);
await d.click("Is 2^31 - 1 prime?");
await d.hold(3.5);
await d.scrollBy(850, 1800);
await d.hold(1.5);
await finish();

scene("8. Time shifting");
await d.nav("/dashboard/schedule", 3500);
line("A request can be deferred. I'll send one with a six hour deadline.");
await Promise.all([gw("deferred", DEFERRED, { key: "team-support", defer: "6h", maxTokens: 400 }), finish()]);
await d.hold(1);
await d.scrollBy(700, 1600);
line("Right now is already the lowest-demand hour in the profile, so Dropwise runs it at once, and says why. At a busier hour it would wait for the quiet one.");
await d.hold(2);
await d.scrollBy(500, 1500);
await finish();
line("The hourly profile is illustrative and says so. The water estimate doesn't change with the hour, so we claim no saving.");
await d.hold(1.5);
if (!DRY) {
  await d.click("Receipt →");
  await d.hold(2.5);
  await d.scrollBy(700, 1600);
}
await finish();

scene("9. Claim checker");
await d.nav("/claims?demo=1", 3500);
line("The claim checker splits a claim into parts and checks each against the registry: supported, overstated, understated, unsupported or outdated, with citations. This one uses a saved example.");
await d.hold(2.5);
await d.click("button[aria-pressed]");
await d.hold(3);
await d.scrollBy(700, 1800);
await d.hold(1.5);
await finish();

scene("10. The registry");
await d.nav("/registry", 3500);
line("Every factor has a source, a date and a signed version.");
await d.hold(1.5);
await d.scrollBy(750, 1800);
await finish();
await d.click("tr[role=button]");
await d.hold(3.5);
await d.press("Escape");
await d.hold(1);
line("Tavily finds newer sources, Haiku reads the figure, and code checks the quote is really in the source before an old figure is flagged stale. Nothing enters the registry until a person accepts it.");
await d.scrollTo("Check for newer sources");
await d.click("Check for newer sources");
await d.waitFor(d.text("Before ·"), { timeout: 30_000, keep: 99 });
await d.hold(2.5);
await d.scrollBy(500, 1800);
await finish();

scene("11. Close");
await d.nav("/", 3000);
line("Dropwise: measured where it can be, estimated where it must be, and honest about which is which. It is open source. Thank you.");
await d.evaluate(`window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })`);
await finish();
await d.hold(1.5);

} catch (e) {
  failure = e;
  console.error("recording stopped early:", e.message);
}
const end = Date.now();
d.stop();

// ---- outputs -------------------------------------------------------------------------------------------------------
const t = timeline({ frames: d.frames, cuts: d.cuts, start, end, markers });
const hhmm = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
writeFileSync(join(work, "timeline.txt"), t.lines.map((l) => `${l.t.toFixed(3)}\t${l.file}`).join("\n") + "\n");

let md = `# Dropwise demo: voice-over script with timings\n\nThe silent video runs **${hhmm(t.duration)}**. Play it and read each line at its time; the pace assumed is about 2.3 words a second, so each line ends before the next starts.\n\n| Time | Scene | You say |\n|---|---|---|\n`;
let srt = "";
let n = 1;
for (const m of t.marks) {
  if (m.kind === "scene") md += `| **${hhmm(m.t)}** | **${m.name}** | |\n`;
  else {
    md += `| ${hhmm(m.t)} to ${hhmm(m.t + m.ms / 1000)} | | ${m.text} |\n`;
    srt += `${n++}\n${srtTime(m.t)} --> ${srtTime(m.t + m.ms / 1000)}\n${m.text}\n\n`;
  }
}
md += `\n## Real requests made for this recording\n\n\`\`\`json\n${JSON.stringify(calls, null, 2)}\n\`\`\`\n`;
writeFileSync(join(work, "script.md"), md);
writeFileSync(join(work, "script.srt"), srt);
writeFileSync(join(work, "calls.json"), JSON.stringify(calls, null, 2));
console.log(`done: ${t.lines.length} frames, ${hhmm(t.duration)} of video`);
d.close();
process.exit(failure ? 1 : 0);
