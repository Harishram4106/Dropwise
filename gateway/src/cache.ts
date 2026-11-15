// Response cache for repeat prompts. A prompt matches when it is the same after normalizing case,
// whitespace and trailing punctuation: an exact-match cache, not an embedding-based one (the only
// provider key we have is Anthropic's, and it has no embeddings endpoint).

import { createHash } from "node:crypto";

interface Entry {
  body: unknown;
  tokens: number;
  storedAt: number;
}

export interface ChatBody {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  tools?: unknown;
  n?: unknown;
  [key: string]: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : JSON.stringify(p))).join("\n");
  return JSON.stringify(content ?? "");
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[\s.!?]+$/, "").trim();
}

/** Only plain, single-answer chat requests are cached. */
export function cacheable(body: ChatBody): boolean {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  return !body.stream && !hasTools && (body.n === undefined || body.n === 1) && Array.isArray(body.messages);
}

/** Entries are kept per virtual key, so one team is never served another team's cached answer. */
export function cacheKey(body: ChatBody, virtualKey: string): string {
  const messages = (body.messages as { role?: unknown; content?: unknown }[]).map((m) => [String(m.role), normalize(textOf(m.content))]);
  return createHash("sha256").update(JSON.stringify([virtualKey, String(body.model), messages])).digest("hex");
}

export class ResponseCache {
  private entries = new Map<string, Entry>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlMs: number, maxEntries = 1000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): Entry | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit;
  }

  set(key: string, body: unknown, tokens: number): void {
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { body, tokens, storedAt: Date.now() });
  }

  get size(): number {
    return this.entries.size;
  }
}
