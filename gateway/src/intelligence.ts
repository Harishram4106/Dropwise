// Client for the intelligence API: the right-sizing classifier and the signed Evidence Registry.

import type { RegistrySnapshot, RouteDecision } from "./types.ts";

const REGISTRY_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 3000;

export class IntelligenceClient {
  private snapshot: RegistrySnapshot | null = null;
  private fetchedAt = 0;
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async classify(body: unknown): Promise<RouteDecision> {
    const res = await fetch(`${this.baseUrl}/route/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`classifier returned ${res.status}: ${await res.text()}`);
    return (await res.json()) as RouteDecision;
  }

  /** The latest signed registry, refreshed every 5 minutes. Keeps the last good copy if a refresh fails. */
  async registry(): Promise<RegistrySnapshot | null> {
    if (this.snapshot && Date.now() - this.fetchedAt < REGISTRY_TTL_MS) return this.snapshot;
    try {
      const res = await fetch(`${this.baseUrl}/registry`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`registry returned ${res.status}`);
      this.snapshot = (await res.json()) as RegistrySnapshot;
      this.fetchedAt = Date.now();
    } catch (err) {
      if (!this.snapshot) console.warn(`[gateway] registry unavailable: ${(err as Error).message}`);
    }
    return this.snapshot;
  }

  async reachable(): Promise<boolean> {
    try {
      return (await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) })).ok;
    } catch {
      return false;
    }
  }
}
