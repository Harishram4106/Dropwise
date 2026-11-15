// A stand-in for Bifrost that answers from recorded answers (see recordings.ts).
//
// It speaks just enough of the OpenAI-compatible API for the gateway and the benchmark: POST /v1/chat/completions,
// answered from the recording of that exact system + user prompt, and GET /replay, which the benchmark reads so its
// report can say the answers were replayed, not live. It never calls a model and costs nothing.
//
// Whatever model the request names, the recorded answer is returned. So with Dropwise routing a request from the large
// model to the small one, both get the same answer and the same token counts: the benchmark isolates what Dropwise
// avoids, and prices the tokens at the rates of the model that served each call.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type Recordings, recordKey } from "./recordings.ts";

export interface ReplayOptions {
  /** "recorded": wait as long as the model took when recorded. "none": answer at once. */
  latency?: "recorded" | "none";
}

export interface ReplayInfo {
  replay: true;
  recorded_at: string;
  model: string;
  max_tokens: number;
  answers: number;
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const text = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("") : "";

async function readJSON(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    const body = JSON.parse(raw);
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createReplayServer(recordings: Recordings, options: ReplayOptions = {}): Server {
  const latency = options.latency ?? "recorded";
  const info: ReplayInfo = {
    replay: true,
    recorded_at: recordings.recorded_at,
    model: recordings.model,
    max_tokens: recordings.max_tokens,
    answers: Object.keys(recordings.answers).length,
  };
  let served = 0;

  return createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";
    if (req.method === "GET" && (path === "/replay" || path === "/health")) return send(res, 200, { ok: true, ...info, served });
    if (req.method !== "POST" || path !== "/v1/chat/completions") return send(res, 404, { error: { message: `No route ${req.method} ${path}` } });

    const body = await readJSON(req);
    const messages = Array.isArray(body?.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
    if (!body || !messages.length) return send(res, 400, { error: { message: "Body must be a chat completion request with messages" } });
    if (body.stream) return send(res, 400, { error: { message: "The replay server doesn't stream; send stream: false" } });

    const system = text(messages.find((m) => m.role === "system")?.content);
    const user = text([...messages].reverse().find((m) => m.role === "user")?.content);
    const answer = recordings.answers[recordKey(system, user)];
    if (!answer) {
      return send(res, 404, { error: { message: `No recorded answer for this prompt. Record it with npm run bench:record (recordings cover ${info.answers} prompts).` } });
    }

    if (latency === "recorded") await new Promise((r) => setTimeout(r, Math.min(answer.latency_ms, 30_000)));
    served++;
    send(res, 200, {
      id: `replay-${answer.id}-${served}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: typeof body.model === "string" ? body.model : recordings.model,
      choices: [{ index: 0, message: { role: "assistant", content: answer.content }, finish_reason: answer.finish_reason }],
      usage: { prompt_tokens: answer.tokens_in, completion_tokens: answer.tokens_out, total_tokens: answer.tokens_in + answer.tokens_out },
    });
  });
}
