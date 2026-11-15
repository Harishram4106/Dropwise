// Every model call goes through the Bifrost gateway (OpenAI-compatible API), so our own
// AI traffic shows up in Dropwise's receipts and budgets like any other app's.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatJSON(messages: ChatMessage[], model = process.env.EXTRACTION_MODEL): Promise<unknown> {
  if (!model) throw new Error("EXTRACTION_MODEL is not set (e.g. anthropic/claude-haiku-5-5). See .env.example.");
  return parseJSONObject(await chat(messages, model));
}

// Room for a short answer plus the model's thinking: current Claude models always think, and
// Anthropic requires max_tokens on every request.
export const MAX_TOKENS = 4096;

// Plain-text completion. No temperature: current Claude models reject non-default sampling
// settings with a 400, so runs are not exactly repeatable; eval scoring is rule-based instead.
export async function chat(messages: ChatMessage[], model: string): Promise<string> {
  const baseUrl = process.env.BIFROST_URL || "http://localhost:8080";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.BIFROST_VIRTUAL_KEY) headers["x-bf-vk"] = process.env.BIFROST_VIRTUAL_KEY;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, messages }),
  });
  if (!res.ok) throw new Error(`Bifrost request failed (${res.status}): ${await res.text()}`);

  const data = (await res.json()) as { choices: { message: { content: string | null } }[] };
  return data.choices[0]?.message.content ?? "";
}

export function parseJSONObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`Model did not return a JSON object: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}
