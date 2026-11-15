// Request text helpers shared by the classifier and the time-sensitivity check.

export interface ContentPart {
  type: string;
  text?: string;
}

export interface RequestMessage {
  role: string;
  content?: string | ContentPart[] | null;
}

// Accepts an OpenAI-style chat request body, or a bare prompt for the CLI and tests.
export interface ClassifyInput {
  messages?: RequestMessage[];
  prompt?: string;
  tools?: unknown[];
}

export function textOf(content: RequestMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
}

export function hasImage(messages: RequestMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => /image/i.test(p?.type ?? "")));
}

export function messagesOf(input: ClassifyInput): RequestMessage[] {
  if (Array.isArray(input.messages) && input.messages.length) return input.messages;
  if (typeof input.prompt === "string") return [{ role: "user", content: input.prompt }];
  throw new Error('Request needs "messages" (OpenAI chat format) or "prompt"');
}

export function lastUserText(messages: RequestMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return textOf(messages[i].content);
  }
  return "";
}

// The words that tell us what is being asked, without the material it is asked about:
// code blocks and longer quoted passages are input data ("summarise: '...next month...'"),
// so their wording must not make the request look time-sensitive or hard.
export function instructionOf(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/"[^"\n]{20,}"/g, " ")
    .replace(/“[^”]{20,}”/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ~4 characters per token is the usual rule of thumb for English; good enough for a size threshold.
export function approxTokens(messages: RequestMessage[]): number {
  const chars = messages.reduce((n, m) => n + textOf(m.content).length, 0);
  return Math.ceil(chars / 4);
}
