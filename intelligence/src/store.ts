import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Candidate, FactorSpec, RegistryEntry, RegistryVersion } from "./contracts.ts";
import { freshnessScore } from "./freshness.ts";
import { entryHash } from "./integrity.ts";
import { CANDIDATES_FILE, ENTRIES_FILE, FACTORS_FILE, VERSIONS_DIR } from "./paths.ts";

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJSON(file: string, data: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

export const loadFactors = () => readJSON<FactorSpec[]>(FACTORS_FILE, []);
export const loadEntries = () => readJSON<RegistryEntry[]>(ENTRIES_FILE, []);
export const loadCandidates = () => readJSON<Record<string, Candidate[]>>(CANDIDATES_FILE, {});
export const saveCandidates = (c: Record<string, Candidate[]>) => writeJSON(CANDIDATES_FILE, c);

export function refreshDerived(entry: RegistryEntry, now = new Date()): RegistryEntry {
  const updated = { ...entry, freshness_score: freshnessScore(entry.source_date, now) };
  return { ...updated, version_hash: entryHash(updated) };
}

export async function saveEntries(entries: RegistryEntry[], now = new Date()): Promise<RegistryEntry[]> {
  const derived = entries.map((e) => refreshDerived(e, now)).sort((a, b) => a.factor_id.localeCompare(b.factor_id));
  await writeJSON(ENTRIES_FILE, derived);
  return derived;
}

export async function loadVersions(): Promise<RegistryVersion[]> {
  let files: string[];
  try {
    files = await readdir(VERSIONS_DIR);
  } catch {
    return [];
  }
  const versions = await Promise.all(
    files.filter((f) => /^v\d+\.json$/.test(f)).map((f) => readJSON<RegistryVersion | null>(join(VERSIONS_DIR, f), null)),
  );
  return versions.filter((v): v is RegistryVersion => v !== null).sort((a, b) => a.version - b.version);
}

export async function saveVersion(version: RegistryVersion): Promise<string> {
  await mkdir(VERSIONS_DIR, { recursive: true });
  const file = join(VERSIONS_DIR, `v${version.version}.json`);
  await writeJSON(file, version);
  await writeJSON(join(VERSIONS_DIR, "latest.json"), version);
  return file;
}
