// npm run bench:replay -- [--port 8080] [--latency recorded|none] [--file bench/recordings.json]
//
// Serves the recorded answers on the port Bifrost normally uses, so the gateway and the benchmark can run against it
// with no API key and no cost. Start it, then start the gateway (BIFROST_URL=http://localhost:8080) and run
// `npm run bench` (no --yes needed: nothing is spent).

import { parseArgs } from "node:util";
import { createReplayServer } from "./replay.ts";
import { loadRecordings, RECORDINGS_FILE } from "./recordings.ts";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "8080" },
    latency: { type: "string", default: "recorded" },
    file: { type: "string", default: RECORDINGS_FILE },
  },
});

const recordings = await loadRecordings(args.file);
if (!recordings) {
  console.error(`No recordings at ${args.file}. Record them first: npm run bench:record -- --yes`);
  process.exit(1);
}
if (args.latency !== "recorded" && args.latency !== "none") {
  console.error('--latency must be "recorded" or "none"');
  process.exit(1);
}

const port = Number(args.port);
createReplayServer(recordings, { latency: args.latency }).listen(port, () => {
  console.log(`Replay server on http://localhost:${port}, standing in for Bifrost (no model is called).`);
  console.log(`${Object.keys(recordings.answers).length} answers recorded from ${recordings.model} on ${recordings.recorded_at.slice(0, 10)} (max_tokens ${recordings.max_tokens}); latency: ${args.latency}.`);
});
