"use client";

// Deferred jobs (time shifting) and the hourly profile they are scheduled against.
// Live: the gateway's GET /jobs and GET /jobs/profile, re-read every few seconds, and POST /jobs/:id/run for "Run now".
// Demo: a saved snapshot, shifted by whole days so its dates look current but its time of day is kept, and frozen at the
// moment it was saved ("now" is that moment), so every status in it is true for it. Run now needs a live gateway.

import { useCallback, useEffect, useMemo, useState } from "react";
import saved from "@/fixtures/jobs.json";
import { API_URL, type HourlyProfile, type Job } from "@/lib/dropwise";
import { useConnection } from "./connection";
import { useNow } from "./receipts";

const SNAPSHOT = saved as unknown as { saved_at: string; profile: HourlyProfile | null; jobs: Job[] };
const DAY = 86_400_000;

export interface JobsData {
  jobs: Job[];
  profile: HourlyProfile | null;
  profileError: string | null;
  loaded: boolean;
  /** Milliseconds: the current time live, the snapshot's moment in demo. */
  now: number;
  live: boolean;
  runNow: ((id: string) => Promise<void>) | null;
}

const shift = (iso: string | null, by: number) => (iso ? new Date(Date.parse(iso) + by).toISOString() : iso);

function snapshotJobs(): { jobs: Job[]; now: number } {
  const by = Math.round((Date.now() - Date.parse(SNAPSHOT.saved_at)) / DAY) * DAY;
  const jobs = SNAPSHOT.jobs.map((j) => ({
    ...j,
    updated_at: shift(j.updated_at, by) as string,
    deferred: {
      ...j.deferred,
      requested_at: shift(j.deferred.requested_at, by) as string,
      deadline: shift(j.deferred.deadline, by) as string,
      scheduled_for: shift(j.deferred.scheduled_for, by) as string,
      ran_at: shift(j.deferred.ran_at, by),
    },
  }));
  return { jobs, now: Date.parse(SNAPSHOT.saved_at) + by };
}

export function useJobs(): JobsData {
  const { status, fallBack } = useConnection();
  const [live, setLive] = useState<{ jobs: Job[]; profile: HourlyProfile | null; profileError: string | null } | null>(null);
  const clock = useNow();
  const demo = useMemo(() => (status === "demo" ? snapshotJobs() : null), [status]);

  const load = useCallback(async () => {
    try {
      const [j, p] = await Promise.all([
        fetch(`${API_URL}/jobs`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Job[]>) : Promise.reject(new Error(String(r.status))))),
        fetch(`${API_URL}/jobs/profile`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ profile: HourlyProfile | null; error: string | null }>) : Promise.reject(new Error(String(r.status))))),
      ]);
      setLive({ jobs: j, profile: p.profile, profileError: p.error });
    } catch {
      fallBack("The gateway's jobs couldn't be loaded");
    }
  }, [fallBack]);

  useEffect(() => {
    if (status !== "live") return;
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [status, load]);

  const runNow = useCallback(
    async (id: string) => {
      await fetch(`${API_URL}/jobs/${id}/run`, { method: "POST" });
      await load();
    },
    [load],
  );

  if (status === "live") return { jobs: live?.jobs ?? [], profile: live?.profile ?? null, profileError: live?.profileError ?? null, loaded: live !== null, now: clock, live: true, runNow };
  if (demo) return { jobs: demo.jobs, profile: SNAPSHOT.profile, profileError: null, loaded: true, now: demo.now, live: false, runNow: null };
  return { jobs: [], profile: null, profileError: null, loaded: false, now: 0, live: false, runNow: null };
}
