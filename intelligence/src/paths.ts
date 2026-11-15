import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const REGISTRY_DIR = join(ROOT, "registry");
export const FACTORS_FILE = join(REGISTRY_DIR, "factors.json");
export const ENTRIES_FILE = join(REGISTRY_DIR, "entries.json");
export const CANDIDATES_FILE = join(REGISTRY_DIR, "candidates.json");
export const VERSIONS_DIR = join(REGISTRY_DIR, "versions");
export const PUBLIC_KEY_FILE = join(REGISTRY_DIR, "keys", "registry.public.pem");
export const PRIVATE_KEY_FILE = join(REGISTRY_DIR, "keys", "registry.private.pem");
export const TAVILY_CACHE_DIR = join(ROOT, ".cache", "tavily");
export const EVAL_SET_FILE = join(ROOT, "eval", "routing-set.json");
export const EVAL_RESULTS_DIR = join(ROOT, "eval", "results");
