import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scope } from "./types.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export interface GatewayConfig {
  port: number;
  bifrostUrl: string;
  intelligenceUrl: string;
  /** Model that easy prompts are routed to. */
  smallModel: string;
  /** Model that routing may replace. Requests for any other model are never re-routed. */
  largeModel: string;
  routing: boolean;
  cache: boolean;
  cacheTtlMs: number;
  dataDir: string;
  budgetsFile: string;
  /** Deferred jobs (time shifting), kept across restarts. */
  jobsFile: string;
  /** The hourly profile deferred jobs are scheduled against; optional (see src/jobs.ts). */
  hourlyProfileFile: string;
  /** How often the scheduler looks for jobs that are due. */
  jobTickMs: number;
  scope: Scope;
  promptPreviewChars: number;
  dashboardOrigin: string;
}

const on = (v: string | undefined, fallback: boolean) => (v === undefined || v === "" ? fallback : !/^(0|off|false|no)$/i.test(v));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const dataDir = env.DATA_DIR || join(ROOT, "data");
  return {
    port: Number(env.PORT || 8088),
    bifrostUrl: (env.BIFROST_URL || "http://localhost:8080").replace(/\/+$/, ""),
    intelligenceUrl: (env.INTELLIGENCE_URL || "http://localhost:8787").replace(/\/+$/, ""),
    smallModel: env.SMALL_MODEL || "anthropic/claude-haiku-5-5",
    largeModel: env.LARGE_MODEL || "anthropic/claude-opus-5-5",
    routing: on(env.ROUTING, true),
    cache: on(env.CACHE, true),
    cacheTtlMs: Number(env.CACHE_TTL_SECONDS || 3600) * 1000,
    dataDir,
    budgetsFile: env.BUDGETS_FILE || join(dataDir, "budgets.json"),
    jobsFile: env.JOBS_FILE || join(dataDir, "jobs.json"),
    hourlyProfileFile: env.HOURLY_PROFILE_FILE || join(dataDir, "hourly-profile.json"),
    jobTickMs: Number(env.JOB_TICK_SECONDS || 5) * 1000,
    scope: env.SCOPE === "direct_only" ? "direct_only" : "direct_plus_indirect",
    promptPreviewChars: Number(env.PROMPT_PREVIEW_CHARS ?? 80),
    dashboardOrigin: env.DASHBOARD_ORIGIN || "*",
  };
}
