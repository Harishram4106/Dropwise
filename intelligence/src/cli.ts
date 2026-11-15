import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { staleDemo } from "./demo.ts";
import { STALE_BELOW } from "./freshness.ts";
import { buildVersion, generateKeyPair, verifyChain } from "./integrity.ts";
import { PRIVATE_KEY_FILE, PUBLIC_KEY_FILE } from "./paths.ts";
import { candidateToEntry, formatRange, refresh } from "./pipeline.ts";
import { loadCandidates, loadEntries, loadFactors, loadVersions, saveCandidates, saveEntries, saveVersion } from "./store.ts";

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async status() {
    const entries = await saveEntries(await loadEntries());
    const specs = await loadFactors();
    for (const e of entries) {
      const flag = e.status === "stale" ? "STALE" : e.freshness_score < STALE_BELOW ? "AGING" : "ok";
      console.log(
        `${flag.padEnd(5)}  ${e.factor_id.padEnd(42)} ${formatRange(e.range).padStart(7)} ${e.unit.padEnd(26)} ` +
          `fresh=${e.freshness_score.toFixed(2)}  counts=${e.counts}  verified=${e.last_verified} (${e.verified_by})`,
      );
    }
    const missing = specs.filter((s) => !entries.some((e) => e.factor_id === s.factor_id));
    for (const s of missing) console.log(`EMPTY  ${s.factor_id.padEnd(42)} (${s.role}) no entry yet, run refresh`);
  },

  async rehash() {
    const entries = await saveEntries(await loadEntries());
    console.log(`Recomputed freshness and version_hash for ${entries.length} entries.`);
  },

  async refresh(ids) {
    const specs = (await loadFactors()).filter((s) => ids.length === 0 || ids.includes(s.factor_id));
    if (specs.length === 0) throw new Error(`No factor specs match: ${ids.join(", ")}`);
    const { entries, candidates, outcomes } = await refresh(specs, await loadEntries());
    await saveEntries(entries);
    await saveCandidates({ ...(await loadCandidates()), ...candidates });
    for (const o of outcomes) console.log(`${o.action.padEnd(16)} ${o.factor_id}${o.detail ? `  ${o.detail}` : ""}`);
    if (Object.keys(candidates).length > 0) console.log("\nReview registry/candidates.json, then: npm run registry -- accept <factor_id> [index]");
  },

  async accept([factorId, index = "0"]) {
    if (!factorId) throw new Error("Usage: accept <factor_id> [candidate index]");
    const spec = (await loadFactors()).find((s) => s.factor_id === factorId);
    if (!spec) throw new Error(`No factor spec named ${factorId}`);
    const candidates = await loadCandidates();
    const candidate = candidates[factorId]?.[Number(index)];
    if (!candidate) throw new Error(`No candidate ${index} for ${factorId}`);

    const entries = (await loadEntries()).filter((e) => e.factor_id !== factorId);
    await saveEntries([...entries, candidateToEntry(candidate, spec)]);
    delete candidates[factorId];
    await saveCandidates(candidates);
    console.log(`Accepted ${factorId}: ${formatRange(candidate.range)} ${candidate.unit} from ${candidate.source_url}`);
  },

  async keygen() {
    const existing = await readFile(PRIVATE_KEY_FILE, "utf8").catch(() => null);
    if (existing) throw new Error(`${PRIVATE_KEY_FILE} already exists; delete it first to rotate keys.`);
    const { publicPem, privatePem } = generateKeyPair();
    await mkdir(dirname(PUBLIC_KEY_FILE), { recursive: true });
    await writeFile(PUBLIC_KEY_FILE, publicPem);
    await writeFile(PRIVATE_KEY_FILE, privatePem, { mode: 0o600 });
    console.log(`Wrote ${PUBLIC_KEY_FILE} (commit this) and ${PRIVATE_KEY_FILE} (never commit).`);
  },

  async publish() {
    const keys = {
      publicPem: await readFile(PUBLIC_KEY_FILE, "utf8"),
      privatePem: await readFile(PRIVATE_KEY_FILE, "utf8"),
    };
    const entries = await saveEntries(await loadEntries());
    const versions = await loadVersions();
    const version = buildVersion(entries, versions.at(-1) ?? null, keys);
    const file = await saveVersion(version);
    console.log(`Published v${version.version} → ${file}\nregistry_hash ${version.registry_hash}`);
  },

  async "demo-stale"(args) {
    const d = await staleDemo({ live: args.includes("--live") });
    if (d.warning) console.error(`warning: ${d.warning}`);
    const line = (e: typeof d.before) =>
      `${(e.status === "stale" ? "STALE" : "ok").padEnd(5)}  ${e.factor_id}  ${formatRange(e.range)} ${e.unit}  (${e.source_date})`;
    console.log(`Stale-factor demo (${d.mode}); the signed registry is not changed\n`);
    console.log(`Before   ${line(d.before)}`);
    console.log(`After    ${line(d.after)}`);
    if (d.after.superseded_by) console.log(`         superseded_by ${d.after.superseded_by}`);
    console.log(`\n${d.explanation}`);
  },

  async check() {
    const versions = await loadVersions();
    if (versions.length === 0) return console.log("No published versions yet.");
    const problems = verifyChain(versions, await readFile(PUBLIC_KEY_FILE, "utf8"));
    if (problems.length > 0) {
      for (const p of problems) console.error(`FAIL  ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log(`OK  ${versions.length} versions, chain intact, latest ${versions.at(-1)!.registry_hash}`);
  },
};

const [name = "status", ...args] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(`Unknown command "${name}". Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
command(args).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
