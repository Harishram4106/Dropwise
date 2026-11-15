// npm run fake-stack (from gateway/). For rehearsing the dashboard's live mode for free; never for real numbers.
// Test harness for the dashboard's live mode: real intelligence API + real gateway on :8088 (CORS *),
// a fake model instead of Bifrost (no API calls, no cost), and one request every 3 s from the bench prompts.
import { copyFile, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { createApiServer } = await import(`${repo}/intelligence/src/server.ts`);
const { loadConfig } = await import(`${repo}/gateway/src/config.ts`);
const { createDeps, createGatewayServer } = await import(`${repo}/gateway/src/server.ts`);
const { prompts, system_prompt } = (await import(`${repo}/gateway/bench/prompts.json`, { with: { type: "json" } })).default;

const fake = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const small = String(body.model).includes("haiku");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: small ? 180 : 620 } }));
});
const listen = (s: Server, p = 0) => new Promise<void>((r) => s.listen(p, r));
const port = (s: Server) => (s.address() as AddressInfo).port;
const intelligence: Server = createApiServer();
await Promise.all([listen(fake), listen(intelligence)]);
const dataDir = await mkdtemp(join(tmpdir(), "dropwise-live-"));
await copyFile(`${repo}/gateway/data/budgets.json`, join(dataDir, "budgets.json"));
const config = loadConfig({
  DATA_DIR: dataDir, PORT: "8088", DASHBOARD_ORIGIN: "*", PROMPT_PREVIEW_CHARS: "80",
  BIFROST_URL: `http://localhost:${port(fake)}`, INTELLIGENCE_URL: `http://localhost:${port(intelligence)}`,
  SMALL_MODEL: "anthropic/claude-haiku-5-5", LARGE_MODEL: "anthropic/claude-opus-5-5",
});
await listen(createGatewayServer(await createDeps(config)), 8088);
console.log("fake-model gateway on http://localhost:8088");

let i = 0;
setInterval(async () => {
  const p = prompts[(i * 7) % 24 + (i % 3) * 50];
  i++;
  await fetch("http://localhost:8088/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dropwise-key": ["team-search", "team-support", "team-research"][i % 3] },
    body: JSON.stringify({ model: "anthropic/claude-opus-5-5", messages: [{ role: "system", content: system_prompt }, { role: "user", content: p.text }] }),
  }).then((r) => r.text()).catch((e) => console.error(e.message));
}, 3000);
