// Time shifting: deferred requests wait for a lower-impact hour, then run through the normal path.
// A fake model stands in for Bifrost, so nothing is spent.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "../../intelligence/src/server.ts";
import { loadConfig } from "../src/config.ts";
import { chooseRunTime, type HourlyProfile, JobStore, localHour, parseDeadline, validateProfile } from "../src/jobs.ts";
import type { Deps } from "../src/proxy.ts";
import { runDue } from "../src/scheduler.ts";
import { createDeps, createGatewayServer } from "../src/server.ts";

const LARGE = "anthropic/claude-opus-5-5";
const fake = { server: createServer(), calls: 0 };
let intelligence: Server;
const servers: Server[] = [];

const port = (s: Server) => (s.address() as AddressInfo).port;
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, r));

before(async () => {
  fake.server.on("request", async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end("{}");
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
    fake.calls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 200 } }));
  });
  intelligence = createApiServer();
  await Promise.all([listen(fake.server), listen(intelligence)]);
  servers.push(fake.server, intelligence);
});

after(() => servers.forEach((s) => s.close()));

/** A profile where every hour is 1.0, except one hour that is 0.5. */
const dip = (hourUtc: number): HourlyProfile => ({
  name: "test profile",
  source: "a test",
  illustrative: true,
  timezone: "UTC",
  relative_index: Array.from({ length: 24 }, (_, h) => (h === hourUtc ? 0.5 : 1)),
});

async function stack(profile?: HourlyProfile) {
  const dataDir = await mkdtemp(join(tmpdir(), "dropwise-jobs-"));
  await writeFile(join(dataDir, "budgets.json"), JSON.stringify({ period: "day", keys: { "*": { limit_ml: 100000 } } }));
  if (profile) await writeFile(join(dataDir, "hourly-profile.json"), JSON.stringify(profile));
  const config = loadConfig({ DATA_DIR: dataDir, BIFROST_URL: `http://localhost:${port(fake.server)}`, INTELLIGENCE_URL: `http://localhost:${port(intelligence)}`, LARGE_MODEL: LARGE });
  const deps = await createDeps(config);
  const server = createGatewayServer(deps);
  await listen(server);
  servers.push(server);
  const url = `http://localhost:${port(server)}`;
  const chat = (content: string, headers: Record<string, string> = {}, extra: object = {}) =>
    fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dropwise-key": "team-batch", authorization: "Bearer secret-token", ...headers },
      body: JSON.stringify({ model: LARGE, messages: [{ role: "user", content }], ...extra }),
    });
  return { dataDir, deps, url, chat, json: async (path: string, init?: RequestInit) => (await fetch(`${url}${path}`, init)).json() };
}

test("a deadline can be a window or a date, and nonsense or out-of-range ones are refused", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  assert.equal(parseDeadline("6h", now).toISOString(), "2026-11-13T16:00:00.000Z");
  assert.equal(parseDeadline("90m", now).toISOString(), "2026-11-13T11:30:00.000Z");
  assert.equal(parseDeadline("2h30m", now).toISOString(), "2026-11-13T12:30:00.000Z");
  assert.equal(parseDeadline("2026-11-14T00:00:00Z", now).toISOString(), "2026-11-14T00:00:00.000Z");
  assert.throws(() => parseDeadline("soon", now), /window like/);
  assert.throws(() => parseDeadline("", now), /window like/);
  assert.throws(() => parseDeadline("2026-11-12T00:00:00Z", now), /already passed/);
  assert.throws(() => parseDeadline("72h", now), /at most 48 hours/);
});

test("local hours follow the profile's time zone", () => {
  assert.equal(localHour(new Date("2026-11-13T05:00:00Z"), "UTC"), 5);
  assert.equal(localHour(new Date("2026-11-13T05:00:00Z"), "America/Chicago"), 23, "UTC-6 in November");
  assert.equal(localHour(new Date("2026-11-13T00:30:00Z"), "UTC"), 0, "midnight is hour 0, not 24");
});

test("it waits for the lowest-impact hour before the deadline, and never longer than that helps", () => {
  const now = new Date("2026-11-13T10:20:00Z");
  const deadline = new Date("2026-11-13T18:00:00Z");

  const later = chooseRunTime(dip(15), now, deadline);
  assert.equal(later.at.toISOString(), "2026-11-13T15:00:00.000Z");
  assert.equal(later.indexNow, 1);
  assert.equal(later.indexAt, 0.5);
  assert.match(later.reason, /15:00 UTC/);
  assert.match(later.reason, /illustrative/);

  assert.equal(chooseRunTime(dip(20), now, deadline).at.getTime(), now.getTime(), "the best hour is after the deadline: nothing to wait for");
  assert.equal(chooseRunTime(dip(10), now, deadline).at.getTime(), now.getTime(), "the current hour is already the best");

  // Ties go to the earliest hour: a flat profile never delays anything.
  const flat: HourlyProfile = { ...dip(0), relative_index: new Array(24).fill(1) };
  assert.equal(chooseRunTime(flat, now, deadline).at.getTime(), now.getTime());

  const none = chooseRunTime(null, now, deadline);
  assert.equal(none.at.getTime(), now.getTime());
  assert.match(none.reason, /No hourly profile/);
});

test("a profile must say where its numbers come from and give 24 positive hours", () => {
  assert.equal(validateProfile(dip(3)).name, "test profile");
  assert.throws(() => validateProfile({ ...dip(3), relative_index: [1, 2, 3] }), /24 positive numbers/);
  assert.throws(() => validateProfile({ ...dip(3), relative_index: new Array(24).fill(0) }), /24 positive numbers/);
  assert.throws(() => validateProfile({ ...dip(3), source: "" }), /where the numbers come from/);
  assert.throws(() => validateProfile({ ...dip(3), illustrative: undefined }), /illustrative/);
  assert.throws(() => validateProfile({ ...dip(3), timezone: "Mars/Olympus" }), /time zone/);
});

test("a deferred request is queued, not answered; it runs through the normal path when run, and its receipt says it was deferred", async () => {
  const dipHour = (new Date().getUTCHours() + 3) % 24;
  const s = await stack(dip(dipHour));
  const before = fake.calls;

  const res = await s.chat("What is the capital of Canada?", { "x-dropwise-defer": "6h" });
  assert.equal(res.status, 202);
  const queued = await res.json();
  assert.equal(queued.status, "scheduled");
  assert.equal(new Date(queued.scheduled_for).getUTCHours(), dipHour);
  assert.equal(new Date(queued.scheduled_for).getUTCMinutes(), 0);
  assert.match(queued.reason, /lowest-impact hour/);
  assert.equal(queued.profile.illustrative, true);
  assert.equal(res.headers.get("x-dropwise-job-id"), queued.job_id);
  assert.equal(fake.calls, before, "no model call was made for a queued request");
  assert.equal((await s.json("/receipts")).length, 0, "and no receipt, no water, no budget yet");

  await runDue(s.deps);
  assert.equal((await s.json(`/jobs/${queued.job_id}`)).status, "scheduled", "not due yet");
  assert.equal(fake.calls, before);

  const ran = await s.json(`/jobs/${queued.job_id}/run`, { method: "POST" });
  assert.equal(ran.status, "done");
  assert.equal(ran.result.choices[0].message.content, "ok");
  assert.equal(fake.calls - before, 1);
  assert.ok(ran.deferred.run_early);

  const receipt = await s.json(`/receipts/${ran.receipt_id}`);
  assert.equal(receipt.deferred.job_id, queued.job_id);
  assert.equal(receipt.deferred.run_early, true);
  assert.deepEqual(receipt.deferred.relative_index, { at_request: 1, at_run: 0.5 });
  assert.equal(receipt.routed_to, "anthropic/claude-haiku-5-5", "a deferred easy prompt is still right-sized");
  assert.ok(receipt.water_ml.high > 0 && receipt.budget, "it is estimated and counted against the key's budget like any request");
  assert.equal(receipt.virtual_key, "team-batch");

  // The estimate doesn't depend on the hour: the same request sent now gets the same range.
  const now = await s.chat("Who wrote Pride and Prejudice?", {});
  const nowReceipt = await s.json(`/receipts/${now.headers.get("x-dropwise-request-id")}`);
  assert.equal(nowReceipt.deferred, undefined, "an interactive request is untouched");
  assert.deepEqual(nowReceipt.water_ml, receipt.water_ml);

  // Every key on the receipt's deferred block is in the contract.
  const schema = JSON.parse(await readFile(new URL("../../contracts/water-receipt.schema.json", import.meta.url), "utf8"));
  const allowed = Object.keys(schema.properties.deferred.properties);
  for (const k of Object.keys(receipt.deferred)) assert.ok(allowed.includes(k), `deferred.${k} is not in the contract`);
  for (const k of schema.properties.deferred.required) assert.ok(k in receipt.deferred, `deferred.${k} is missing`);
});

test("a job never exposes the stored request, and the stored one is dropped once it has run", async () => {
  const s = await stack(dip((new Date().getUTCHours() + 4) % 24));
  const queued = await (await s.chat("Convert 72 degrees Fahrenheit to Celsius.", { "x-dropwise-defer": "8h" })).json();
  const view = await s.json(`/jobs/${queued.job_id}`);
  assert.equal(view.request, undefined, "the API never returns the request (it may carry an authorization header)");
  assert.equal(JSON.stringify(view).includes("secret-token"), false);

  const onDisk = JSON.parse(await readFile(join(s.dataDir, "jobs.json"), "utf8"));
  assert.ok(onDisk[0].request, "while it waits, the request is kept so it can run");
  await s.json(`/jobs/${queued.job_id}/run`, { method: "POST" });
  const after = JSON.parse(await readFile(join(s.dataDir, "jobs.json"), "utf8"));
  assert.equal(after[0].request, undefined, "after it has run, the prompt and the token are no longer kept");
  assert.equal(JSON.stringify(after).includes("secret-token"), false);
});

test("without an hourly profile a deferred request runs straight away and says why", async () => {
  const s = await stack();
  const queued = await (await s.chat("What is the capital of Canada?", { "x-dropwise-defer": "2h" })).json();
  assert.match(queued.reason, /No hourly profile/);
  assert.equal(queued.profile, null);
  await runDue(s.deps);
  const job = await s.json(`/jobs/${queued.job_id}`);
  assert.equal(job.status, "done");
  assert.equal(job.deferred.relative_index, null);
  assert.deepEqual((await s.json("/jobs/profile")).profile, null);
});

test("a deferred repeat is answered from the cache, and bad deferrals are refused", async () => {
  const s = await stack();
  await (await s.chat("What is the capital of Australia?")).text();
  const queued = await (await s.chat("What is the capital of Australia?", { "x-dropwise-defer": "1h" })).json();
  await runDue(s.deps);
  const job = await s.json(`/jobs/${queued.job_id}`);
  assert.equal((await s.json(`/receipts/${job.receipt_id}`)).cache, "hit");

  assert.equal((await s.chat("hi", { "x-dropwise-defer": "whenever" })).status, 400);
  assert.equal((await s.chat("hi", { "x-dropwise-defer": "100h" })).status, 400);
  assert.equal((await s.chat("hi", { "x-dropwise-defer": "1h" }, { stream: true })).status, 400, "streaming can't be deferred");
  assert.equal((await fetch(`${s.url}/jobs/job_nope`)).status, 404);
});

test("jobs survive a restart, and one that was mid-run is run again", async () => {
  const s = await stack(dip((new Date().getUTCHours() + 5) % 24));
  const queued = await (await s.chat("What is the capital of Canada?", { "x-dropwise-defer": "9h" })).json();
  await s.deps.jobs.update(queued.job_id, { status: "running" });

  const again = new JobStore(s.deps.config.jobsFile, s.deps.config.hourlyProfileFile);
  await again.load();
  assert.equal(again.get(queued.job_id)?.status, "scheduled");
  assert.equal(again.profile?.name, "test profile");
  assert.ok(again.raw(queued.job_id)?.request, "the request came back, so it can still run");
  const deps2: Deps = { ...s.deps, jobs: again };
  await again.runEarly(queued.job_id);
  await runDue(deps2);
  assert.equal(again.get(queued.job_id)?.status, "done");
});

test("a failing upstream marks the job failed with the reason instead of losing it", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "dropwise-jobs-bad-"));
  await writeFile(join(dataDir, "budgets.json"), JSON.stringify({ period: "day", keys: {} }));
  const config = loadConfig({ DATA_DIR: dataDir, BIFROST_URL: "http://localhost:1", INTELLIGENCE_URL: `http://localhost:${port(intelligence)}`, LARGE_MODEL: LARGE });
  const deps = await createDeps(config);
  const job = await deps.jobs.create({
    virtualKey: "k",
    model: LARGE,
    body: { model: LARGE, messages: [{ role: "user", content: "hello there" }] },
    headers: { "x-dropwise-key": "k" },
    deadline: new Date(Date.now() + 3600_000),
  });
  await runDue(deps);
  const done = deps.jobs.get(job.id)!;
  assert.equal(done.status, "failed");
  assert.match(done.error ?? "", /Could not reach Bifrost/);
});
