// Time shifting: deferrable requests wait for a lower-impact hour.
//
// A request sent with `x-dropwise-defer: 6h` (or 90m, or an ISO deadline) is not answered at once. The gateway
// queues it, picks the hour before the deadline that the hourly profile marks as lowest-impact, and at that time sends
// it through its normal path (routing, cache, budget, receipt). The caller collects the answer from GET /jobs/:id.
// Interactive requests, without the header, are never delayed.
//
// The hourly profile is a file the operator supplies (HOURLY_PROFILE_FILE): a relative index for each local hour and
// the source it came from. The shipped example is illustrative, not measured, and says so wherever it shows. The water
// ESTIMATE does not change with the hour, because the Evidence Registry has no hourly factor; a receipt records the
// profile's index and source instead, so no water saving from shifting is ever claimed.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface HourlyProfile {
  name: string;
  /** Where the numbers come from, in plain words. */
  source: string;
  source_url?: string;
  /** True when the numbers are an illustration, not a measurement. Shown wherever the profile is. */
  illustrative: boolean;
  /** IANA time zone of the hours, e.g. "America/Chicago" (the data center's local time). */
  timezone: string;
  /** 24 values, local hour 0..23; 1.0 is an average hour, lower is better. A relative index, not a water figure. */
  relative_index: number[];
}

export type JobStatus = "scheduled" | "running" | "done" | "failed";

export interface DeferredInfo {
  job_id: string;
  requested_at: string;
  deadline: string;
  scheduled_for: string;
  ran_at: string | null;
  /** True when someone ran it before its scheduled time (POST /jobs/:id/run). */
  run_early: boolean;
  profile: { name: string; source: string; illustrative: boolean; timezone: string } | null;
  /** The profile's index at request time and at the scheduled hour; null without a profile. Not a water figure. */
  relative_index: { at_request: number; at_run: number } | null;
  reason: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  virtual_key: string;
  model: string;
  prompt_preview?: string;
  deferred: DeferredInfo;
  /** The request as sent, kept only until the job has run. */
  request?: { body: Record<string, unknown>; headers: Record<string, string> };
  receipt_id?: string;
  /** The chat completion, once it has run. */
  result?: unknown;
  error?: string;
  updated_at: string;
}

const MAX_WINDOW_MS = 48 * 3600 * 1000;

/** "6h", "90m", "2h30m", or an ISO date-time; returns the deadline, or throws a message for a 400. */
export function parseDeadline(value: string, now = new Date()): Date {
  const v = value.trim();
  const m = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m)?$/i.exec(v);
  let deadline: Date;
  if (m && (m[1] || m[2])) {
    deadline = new Date(now.getTime() + (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60) * 1000);
  } else {
    deadline = new Date(v);
    if (Number.isNaN(deadline.getTime())) throw new Error('x-dropwise-defer must be a window like "6h" or "90m", or an ISO date-time deadline');
  }
  if (deadline.getTime() <= now.getTime()) throw new Error("x-dropwise-defer: the deadline has already passed");
  if (deadline.getTime() - now.getTime() > MAX_WINDOW_MS) throw new Error("x-dropwise-defer: the window can be at most 48 hours");
  return deadline;
}

export function validateProfile(p: unknown): HourlyProfile {
  const x = p as HourlyProfile;
  if (!x || typeof x !== "object") throw new Error("profile must be an object");
  if (!Array.isArray(x.relative_index) || x.relative_index.length !== 24 || !x.relative_index.every((n) => typeof n === "number" && n > 0)) {
    throw new Error("profile.relative_index must be 24 positive numbers, one per local hour");
  }
  if (typeof x.source !== "string" || !x.source.trim()) throw new Error("profile.source must say where the numbers come from");
  if (typeof x.illustrative !== "boolean") throw new Error("profile.illustrative must be true or false");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: x.timezone }).format(0);
  } catch {
    throw new Error(`profile.timezone "${x.timezone}" is not a known time zone`);
  }
  return { name: x.name || "hourly profile", source: x.source, source_url: x.source_url, illustrative: x.illustrative, timezone: x.timezone, relative_index: x.relative_index };
}

export function localHour(at: Date, timezone: string): number {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(at));
  return h === 24 ? 0 : h;
}

/**
 * The best time to run before the deadline: now, or the start of a later hour, whichever has the lowest index.
 * Ties go to the earliest, so a job never waits for an hour that is no better.
 */
export function chooseRunTime(profile: HourlyProfile | null, now: Date, deadline: Date): { at: Date; reason: string; indexNow: number | null; indexAt: number | null } {
  if (!profile) return { at: now, reason: "No hourly profile is configured, so there is no lower-impact hour to wait for: it runs now.", indexNow: null, indexAt: null };
  const idx = (d: Date) => profile.relative_index[localHour(d, profile.timezone)];
  const candidates = [now];
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  for (const t = next; t.getTime() < deadline.getTime(); t.setUTCHours(t.getUTCHours() + 1)) candidates.push(new Date(t));
  let best = candidates[0];
  for (const c of candidates) if (idx(c) < idx(best) - 1e-9) best = c;
  const indexNow = idx(now);
  const indexAt = idx(best);
  const tag = profile.illustrative ? " (illustrative profile, not measured)" : "";
  const reason =
    best === now
      ? `The current hour is already the lowest-impact one before the deadline${tag}: it runs now.`
      : `Waits for ${String(localHour(best, profile.timezone)).padStart(2, "0")}:00 ${profile.timezone}, the lowest-impact hour before the deadline: index ${indexAt} against ${indexNow} now${tag}.`;
  return { at: best, reason, indexNow, indexAt };
}

export class JobStore {
  readonly events = new EventEmitter();
  private jobs = new Map<string, Job>();
  private writing: Promise<void> = Promise.resolve();
  profile: HourlyProfile | null = null;
  profileError: string | null = null;

  private file: string;
  private profileFile: string;

  constructor(file: string, profileFile: string) {
    this.file = file;
    this.profileFile = profileFile;
    this.events.setMaxListeners(100);
  }

  async load(): Promise<void> {
    try {
      const list = JSON.parse(await readFile(this.file, "utf8")) as Job[];
      for (const j of list) {
        // A job that was running when the gateway stopped is run again.
        if (j.status === "running") j.status = "scheduled";
        this.jobs.set(j.id, j);
      }
    } catch {
      this.jobs.clear();
    }
    try {
      this.profile = validateProfile(JSON.parse(await readFile(this.profileFile, "utf8")));
      this.profileError = null;
    } catch (err) {
      this.profile = null;
      this.profileError = (err as NodeJS.ErrnoException).code === "ENOENT" ? null : `hourly profile ignored: ${(err as Error).message}`;
    }
  }

  list(limit = 100): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.deferred.requested_at.localeCompare(a.deferred.requested_at)).slice(0, limit).map((j) => this.view(j));
  }

  get(id: string): Job | undefined {
    const j = this.jobs.get(id);
    return j && this.view(j);
  }

  /** The stored job, request included, for the scheduler. */
  raw(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Public view: never the stored request (it may hold an authorization header). */
  private view(j: Job): Job {
    const { request, ...rest } = j;
    void request;
    return rest;
  }

  due(now = new Date()): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === "scheduled" && Date.parse(j.deferred.scheduled_for) <= now.getTime());
  }

  async create(input: { virtualKey: string; model: string; preview?: string; body: Record<string, unknown>; headers: Record<string, string>; deadline: Date; now?: Date }): Promise<Job> {
    const now = input.now ?? new Date();
    const plan = chooseRunTime(this.profile, now, input.deadline);
    const job: Job = {
      id: `job_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      status: "scheduled",
      virtual_key: input.virtualKey,
      model: input.model,
      ...(input.preview ? { prompt_preview: input.preview } : {}),
      deferred: {
        job_id: "",
        requested_at: now.toISOString(),
        deadline: input.deadline.toISOString(),
        scheduled_for: plan.at.toISOString(),
        ran_at: null,
        run_early: false,
        profile: this.profile ? { name: this.profile.name, source: this.profile.source, illustrative: this.profile.illustrative, timezone: this.profile.timezone } : null,
        relative_index: plan.indexNow === null || plan.indexAt === null ? null : { at_request: plan.indexNow, at_run: plan.indexAt },
        reason: plan.reason,
      },
      request: { body: input.body, headers: input.headers },
      updated_at: now.toISOString(),
    };
    job.deferred.job_id = job.id;
    this.jobs.set(job.id, job);
    await this.persist(job);
    return this.view(job);
  }

  async update(id: string, change: Partial<Job>): Promise<Job | undefined> {
    const j = this.jobs.get(id);
    if (!j) return undefined;
    Object.assign(j, change, { updated_at: new Date().toISOString() });
    // Once it has run, the request (prompt and any auth header) is no longer kept.
    if (j.status === "done" || j.status === "failed") delete j.request;
    await this.persist(j);
    return this.view(j);
  }

  /** Move a scheduled job to now (an operator's choice, recorded on the receipt). */
  async runEarly(id: string): Promise<Job | undefined> {
    const j = this.jobs.get(id);
    if (!j || j.status !== "scheduled") return j && this.view(j);
    j.deferred = { ...j.deferred, scheduled_for: new Date().toISOString(), run_early: true };
    return this.update(id, {});
  }

  private persist(job: Job): Promise<void> {
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify([...this.jobs.values()], null, 1));
    });
    this.events.emit("job", this.view(job));
    return this.writing;
  }
}
