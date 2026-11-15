// Recorded model answers for the benchmark.
//
// Each of the 150 unique prompts is sent to one model once (see record.ts) and its answer, token counts and time are
// saved. The replay server (replay.ts) then answers the benchmark's requests from this file, standing in for Bifrost,
// so the before/after benchmark can be re-run any number of times at no cost and with identical answers on both sides.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RECORDINGS_FILE = fileURLToPath(new URL("./recordings.json", import.meta.url));

export interface RecordedAnswer {
  id: string;
  content: string;
  tokens_in: number;
  tokens_out: number;
  finish_reason: string;
  /** How long the model took when recorded; the replay server can wait this long, so latency stays realistic. */
  latency_ms: number;
}

export interface Recordings {
  recorded_at: string;
  /** The model that wrote these answers. */
  model: string;
  max_tokens: number;
  /** What recording them cost, from measured tokens at list prices (USD). */
  cost_usd: number | null;
  answers: Record<string, RecordedAnswer>;
}

/** The key a request is looked up by: its system prompt and its user message, exactly as sent. */
export const recordKey = (system: string, user: string) => createHash("sha256").update(`${system}\n---\n${user}`).digest("hex");

export async function loadRecordings(file = RECORDINGS_FILE): Promise<Recordings | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Recordings;
  } catch {
    return null;
  }
}

export async function saveRecordings(recordings: Recordings, file = RECORDINGS_FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(recordings, null, 1) + "\n");
}
