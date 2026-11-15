// Runs deferred jobs when their hour comes. Each job goes through the gateway's normal request path
// (classify, route, cache, forward, estimate, budget, receipt), and its receipt records that it was deferred.

import { handleChat, type Deps, type Out } from "./proxy.ts";
import type { Job } from "./jobs.ts";

/** Collects a reply instead of writing it to a socket. */
class Collector implements Out {
  status = 200;
  headers: Record<string, string> = {};
  text = "";
  writeHead(status: number, headers: Record<string, string> = {}) {
    this.status = status;
    this.headers = headers;
    return this;
  }
  write(chunk: Uint8Array | string) {
    this.text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }
  end(data?: string) {
    if (data) this.text += data;
  }
}

const running = new Set<string>();

/** Runs one job now. Safe to call for a job that is already running or finished: it does nothing. */
export async function runJob(deps: Deps, id: string): Promise<void> {
  const job = deps.jobs.raw(id);
  if (!job || !job.request || running.has(id) || (job.status !== "scheduled" && job.status !== "running")) return;
  running.add(id);
  try {
    await deps.jobs.update(id, { status: "running" });
    const deferred = { ...job.deferred, ran_at: new Date().toISOString() };
    const out = new Collector();
    try {
      await handleChat(deps, job.request.body as never, job.request.headers, out, { deferred });
    } catch (err) {
      out.status = (err as { status?: number }).status ?? 500;
      out.text = JSON.stringify({ error: (err as Error).message });
    }
    let result: unknown;
    try {
      result = JSON.parse(out.text);
    } catch {
      result = out.text;
    }
    const ok = out.status >= 200 && out.status < 300;
    const change: Partial<Job> = { deferred, status: ok ? "done" : "failed" };
    if (ok) {
      change.result = result;
      change.receipt_id = out.headers["x-dropwise-request-id"];
    } else {
      change.error = `HTTP ${out.status}: ${typeof result === "string" ? result : JSON.stringify(result)}`.slice(0, 500);
    }
    await deps.jobs.update(id, change);
  } finally {
    running.delete(id);
  }
}

/** Looks for due jobs every `tickMs` and runs them, a few at a time. Returns a function that stops it. */
export function startScheduler(deps: Deps, tickMs = deps.config.jobTickMs): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const due = deps.jobs.due();
      for (let i = 0; i < due.length; i += 4) await Promise.all(due.slice(i, i + 4).map((j) => runJob(deps, j.id)));
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), tickMs);
  void tick();
  return () => clearInterval(timer);
}

/** Runs everything that is due, once. For tests, and for a "run now" request. */
export async function runDue(deps: Deps): Promise<void> {
  await Promise.all(deps.jobs.due().map((j) => runJob(deps, j.id)));
}
