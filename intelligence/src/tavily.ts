import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalize, sha256 } from "./integrity.ts";
import { TAVILY_CACHE_DIR } from "./paths.ts";

export interface TavilySearchRequest {
  query: string;
  include_domains?: string[];
  time_range?: "day" | "week" | "month" | "year";
  max_results?: number;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

const SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_TTL_MS = 7 * 86_400_000;

// Results are cached on disk so re-runs during development don't spend Tavily credits.
export async function tavilySearch(
  request: TavilySearchRequest,
  { ttlMs = DEFAULT_TTL_MS, cacheDir = TAVILY_CACHE_DIR } = {},
): Promise<TavilyResult[]> {
  const body = { search_depth: "advanced", max_results: 5, ...request };
  const cacheFile = join(cacheDir, `${sha256(canonicalize(body)).slice("sha256:".length)}.json`);

  const cached = await readCache(cacheFile, ttlMs);
  if (cached) return cached;

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set. Copy .env.example to .env and add your key.");

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily search failed (${res.status}): ${await res.text()}`);

  const { results } = (await res.json()) as { results: TavilyResult[] };
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(results, null, 2));
  return results;
}

async function readCache(file: string, ttlMs: number): Promise<TavilyResult[] | null> {
  try {
    const { mtimeMs } = await stat(file);
    if (Date.now() - mtimeMs > ttlMs) return null;
    return JSON.parse(await readFile(file, "utf8")) as TavilyResult[];
  } catch {
    return null;
  }
}
