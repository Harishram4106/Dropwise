import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { finalAnswer, scoreAnswer, type AnswerCheck } from "../src/routing/checks.ts";
import { classify } from "../src/routing/classify.ts";
import { evaluateQuality, evaluateRouting, loadEvalSet, validateEvalSet, type EvalSet } from "../src/routing/eval.ts";
import { timeSensitivity } from "../src/routing/timeliness.ts";
import { createApiServer } from "../src/server.ts";

const tier = (prompt: string) => classify({ prompt }).tier;
const timely = (prompt: string) => classify({ prompt }).time_sensitive;

test("easy prompts go small, hard prompts stay large", () => {
  assert.equal(tier("What is the capital of Australia?"), "small");
  assert.equal(tier("Convert 26.2 miles to kilometres."), "small");
  assert.equal(tier("Translate \"good morning\" into French."), "small");
  assert.equal(tier("Prove that there are infinitely many prime numbers."), "large");
  assert.equal(tier("Is 2^31 - 1 prime?"), "large");
  assert.equal(tier("Write a 600-word blog post about trees."), "large");
  assert.equal(tier("I'm taking warfarin. Is it safe to also take ibuprofen?"), "large");
  assert.equal(tier("What does this print?\n```python\nprint(1)\n```"), "large");
});

test("a prompt with no clear signal stays on the large model", () => {
  const d = classify({ prompt: "Tell me something interesting about my situation" });
  assert.equal(d.tier, "large");
  assert.equal(d.confidence, 0.5);
});

test("images, tools, long context and long conversations stay large", () => {
  const image = classify({
    messages: [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url" }] }],
  });
  assert.deepEqual([image.tier, image.signals[0]], ["large", "image"]);
  assert.equal(classify({ prompt: "What is 2 plus 2?", tools: [{ type: "function" }] }).tier, "large");
  assert.equal(classify({ prompt: `Summarise this: ${"word ".repeat(2000)}` }).tier, "large");

  const turns = Array.from({ length: 4 }, () => [
    { role: "user", content: "What is the capital of France?" },
    { role: "assistant", content: "Paris." },
  ]).flat();
  assert.equal(classify({ messages: turns }).tier, "large");
});

test("the confidence threshold is a quality guard you can raise", () => {
  assert.equal(classify({ prompt: "What is the capital of Australia?" }, { minConfidence: 0.85 }).tier, "large");
  assert.equal(classify({ prompt: "What is the capital of Australia?" }, { minConfidence: 0.7 }).tier, "small");
});

test("time-sensitive prompts bypass the cache; evergreen look-alikes don't", () => {
  assert.equal(classify({ prompt: "What's the weather in Chennai today?" }).cache, "bypass");
  assert.ok(timely("Who is the current prime minister of the UK?"));
  assert.ok(timely("Who won the race last weekend?"));
  assert.ok(timely("Who won the match?"));
  assert.ok(timely("What is the latest version of Node.js?"));

  assert.ok(!timely("Where do emperor penguins live?"));
  assert.ok(!timely("What unit is electric current measured in?"));
  assert.ok(!timely("Who won the 1966 FIFA World Cup?"));
  assert.ok(!timely('Summarise: "The council will extend library hours starting next month, funded by parking fees."'));
  assert.equal(classify({ prompt: "Who is the current prime minister?" }).tier, "small", "prime minister is not maths");
});

test("future years count only with an event", () => {
  const now = new Date("2026-11-08");
  assert.ok(timeSensitivity("Who will be the 2027 champion?", now).time_sensitive);
  assert.ok(!timeSensitivity("If 1 March 2027 is a Monday, what day is 1 March 2028?", now).time_sensitive);
});

test("answer checks read the final Answer line", () => {
  const reply = "Let x be the ball. 1.10 - 1.00 = 0.10 is tempting.\nAnswer: 5 cents";
  assert.equal(finalAnswer(reply), "5 cents");
  assert.equal(scoreAnswer({ type: "number", value: [5, 0.05] }, reply), true);
  assert.equal(scoreAnswer({ type: "number", value: 10 }, reply), false, "working-out does not count");
  assert.equal(scoreAnswer({ type: "number", value: 129.6, tolerance: 0.5 }, "Answer: 129.6 litres"), true);
  assert.equal(scoreAnswer({ type: "number", value: 129600 }, "Answer: 129,600 mL"), true);
});

test("choice, contains, json, regex and none checks", () => {
  const choice: AnswerCheck = { type: "choice", options: ["positive", "negative", "neutral"], value: "negative" };
  assert.equal(scoreAnswer(choice, "Answer: Negative"), true);
  assert.equal(scoreAnswer(choice, "Answer: negative or neutral"), false, "hedging between options fails");
  assert.equal(scoreAnswer({ type: "contains", all: [["doesn't", "does not"], "has"] }, "Answer: She doesn’t like it; he has two."), true);
  assert.equal(scoreAnswer({ type: "json", equals: { name: "Priya", age: 34 } }, '```json\n{"name": "Priya", "age": 34}\n```'), true);
  assert.equal(scoreAnswer({ type: "json", equals: { age: 34 } }, '{"age": "34"}'), false);
  assert.equal(scoreAnswer({ type: "regex", all: ["\\bOK\\b"], flags: "i" }, "Answer: ok"), true);
  assert.equal(scoreAnswer({ type: "none", reason: "changes" }, "anything"), null);
});

test("the eval set is valid and no hard prompt in it is routed small", async () => {
  const set = await loadEvalSet();
  assert.deepEqual(validateEvalSet(set), []);
  const report = evaluateRouting(set);
  assert.deepEqual(report.hard_routed_small, []);
  assert.deepEqual(report.time_sensitivity.missed, []);
});

const tinySet: EvalSet = {
  description: "test",
  system_prompt: "End with Answer:",
  items: [
    { id: "easy", category: "lookup", prompt: "What is the capital of Australia?", expected_tier: "small", time_sensitive: false, check: { type: "contains", all: ["Canberra"] } },
    { id: "hard", category: "math", prompt: "Is 2^31 - 1 prime?", expected_tier: "large", time_sensitive: false, check: { type: "regex", all: ["yes"] } },
    { id: "timely", category: "timely", prompt: "Weather today?", expected_tier: "small", time_sensitive: true, check: { type: "none", reason: "changes" } },
  ],
};

test("quality eval uses small answers only where the classifier chose small", async () => {
  const calls: string[] = [];
  const answers: Record<string, Record<string, string>> = {
    big: { easy: "Answer: Canberra", hard: "Answer: Yes" },
    tiny: { easy: "Answer: Canberra", hard: "Answer: No" },
  };
  const report = await evaluateQuality(tinySet, {
    small: "tiny",
    large: "big",
    answer: async (model, _system, prompt) => {
      calls.push(`${model}:${prompt}`);
      return answers[model][prompt.startsWith("What") ? "easy" : "hard"];
    },
    now: new Date("2026-11-08T00:00:00Z"),
  });
  assert.equal(calls.length, 4, "time-sensitive items are not answered");
  assert.equal(report.items_scored, 2);
  assert.deepEqual(report.pass_rate, { all_large: 1, routed: 1, all_small: 0.5 });
  assert.equal(report.routed_small_share, 0.5);
  assert.equal(report.guard, "pass");
  assert.match(report.eval_set_hash, /^sha256:/);
});

test("quality guard fails when routing loses answers", async () => {
  const report = await evaluateQuality(tinySet, {
    small: "tiny",
    large: "big",
    answer: async (model, _s, prompt) => (model === "tiny" && prompt.startsWith("What") ? "Answer: Sydney" : "Answer: Canberra, yes"),
  });
  assert.equal(report.quality_drop_pts, 50);
  assert.equal(report.guard, "fail");
  assert.deepEqual(report.lost, ["easy"]);
  assert.match(report.recommendation, /caching and budgets/);
});

test("API classifies requests in OpenAI chat format", async () => {
  const server = createApiServer().listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/route/classify`, {
      method: "POST",
      body: JSON.stringify({ model: "x", messages: [{ role: "user", content: "What is the capital of Australia?" }] }),
    });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.deepEqual([d.tier, d.cache, d.classifier_version], ["small", "use", "rules-1"]);

    assert.equal((await fetch(`${base}/route/classify`, { method: "POST", body: "{}" })).status, 400);
    const routing = await (await fetch(`${base}/eval/routing`)).json();
    assert.deepEqual(routing.hard_routed_small, []);
  } finally {
    server.close();
  }
});
