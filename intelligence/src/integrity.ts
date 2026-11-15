import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type { RegistryEntry, RegistryVersion } from "./contracts.ts";

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

// freshness_score decays daily, so it is left out to keep the hash tied to the entry's content.
export function entryHash(entry: RegistryEntry): string {
  const { version_hash: _hash, freshness_score: _freshness, ...content } = entry;
  return sha256(canonicalize(content));
}

export function generateKeyPair(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function fingerprint(publicPem: string): string {
  return sha256(publicPem.trim());
}

export function buildVersion(
  entries: RegistryEntry[],
  previous: RegistryVersion | null,
  keys: { publicPem: string; privatePem: string },
  now = new Date(),
): RegistryVersion {
  const body = {
    version: (previous?.version ?? 0) + 1,
    created_at: now.toISOString(),
    previous_hash: previous?.registry_hash ?? null,
    entries,
  };
  const registry_hash = sha256(canonicalize(body));
  const signature = sign(null, Buffer.from(registry_hash), createPrivateKey(keys.privatePem)).toString("base64");
  return { ...body, registry_hash, signature, public_key_fingerprint: fingerprint(keys.publicPem) };
}

export function verifyChain(versions: RegistryVersion[], publicPem: string): string[] {
  const problems: string[] = [];
  const publicKey = createPublicKey(publicPem);
  let previous: RegistryVersion | null = null;

  for (const v of versions) {
    const label = `v${v.version}`;
    const expectedVersion = (previous?.version ?? 0) + 1;
    if (v.version !== expectedVersion) problems.push(`${label}: expected version ${expectedVersion}`);
    if (v.previous_hash !== (previous?.registry_hash ?? null)) problems.push(`${label}: previous_hash does not match v${previous?.version}`);

    const body = { version: v.version, created_at: v.created_at, previous_hash: v.previous_hash, entries: v.entries };
    const recomputed = sha256(canonicalize(body));
    if (recomputed !== v.registry_hash) problems.push(`${label}: registry_hash does not match contents`);
    if (!verify(null, Buffer.from(v.registry_hash), publicKey, Buffer.from(v.signature, "base64"))) {
      problems.push(`${label}: signature invalid`);
    }
    if (v.public_key_fingerprint !== fingerprint(publicPem)) problems.push(`${label}: signed with a different key`);

    for (const e of v.entries) {
      if (entryHash(e) !== e.version_hash) problems.push(`${label}: entry ${e.factor_id} version_hash does not match contents`);
    }
    previous = v;
  }
  return problems;
}
