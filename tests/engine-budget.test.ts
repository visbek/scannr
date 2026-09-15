import test from "node:test";
import assert from "node:assert/strict";
import { createEngineRunner, fetchEngineAnswer, ProviderRequestError } from "../lib/engine-requests";
import { readClaudeAnswer, readGeminiAnswer, readOpenAIAnswer, readPerplexityAnswer } from "../lib/scan-evidence";

const answer = { text: "A complete answer.", citations: [] };
const deadline = () => AbortSignal.timeout(30_000);

test("answer requests retain models and prompts while bounding tool calls and output", async () => {
  const original = globalThis.fetch;
  const bodies: Record<string, Record<string, unknown>> = {};
  globalThis.fetch = async (url, init) => {
    const host = new URL(String(url)).hostname;
    bodies[host] = JSON.parse(String(init?.body));
    if (host === "api.anthropic.com") return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: answer.text }] });
    if (host === "api.openai.com") return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: answer.text }] }] });
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: answer.text }] } }] });
  };
  try {
    for (const engine of ["claude", "chatgpt", "gemini"] as const) await fetchEngineAnswer(engine, "Which tools suit a small team?", "test-key", deadline());
    const claude = bodies["api.anthropic.com"];
    assert.equal(claude.model, "claude-sonnet-4-5");
    assert.deepEqual(claude.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]);
    assert.equal(claude.max_tokens, 1000);
    assert.deepEqual(claude.messages, [{ role: "user", content: "Which tools suit a small team?" }]);
    const openai = bodies["api.openai.com"];
    assert.equal(openai.max_tool_calls, 2);
    assert.equal(openai.max_output_tokens, 1600);
    assert.equal(openai.model, "gpt-4o-mini");
    const gemini = bodies["generativelanguage.googleapis.com"];
    assert.deepEqual(gemini.generationConfig, { temperature: 0, maxOutputTokens: 2048 });
    assert.deepEqual(gemini.tools, [{ googleSearch: {} }]);
  } finally { globalThis.fetch = original; }
});

test("Claude SDK does not invisibly retry a failed paid request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { type: "rate_limit_error", message: "Rate limited" } }, { status: 429 }); };
  try { await assert.rejects(fetchEngineAnswer("claude", "Which tools?", "test", deadline())); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

test("Gemini waits for Retry-After, recovers once, and never retries the whole scan", async () => {
  let calls = 0;
  const waits: number[] = [];
  const run = createEngineRunner("gemini", "test", deadline(), async () => {
    if (++calls === 1) throw new ProviderRequestError("rate_limit", 429, 2500);
    return answer;
  }, async ms => { waits.push(ms); });
  assert.deepEqual(await run("first"), answer);
  assert.deepEqual(await run("second"), answer);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2600]);
});

test("Gemini has a scan-wide retry ceiling and stops after continued throttling", async () => {
  let calls = 0;
  const run = createEngineRunner("gemini", "test", deadline(), async () => {
    if (++calls % 2) throw new ProviderRequestError("rate_limit", 429, 0);
    return answer;
  }, async () => {});
  await run("one"); await run("two");
  await assert.rejects(run("three"));
  await assert.rejects(run("four"));
  assert.equal(calls, 5, "only two retry requests allowed across the engine run");
});

test("daily quota, invalid access and long retry delays stop remaining calls without waiting", async () => {
  for (const error of [new ProviderRequestError("quota_exhausted", 429), new ProviderRequestError("provider_access", 403), new ProviderRequestError("rate_limit", 429, 60_000)]) {
    let calls = 0;
    const run = createEngineRunner("gemini", "test", deadline(), async () => { calls++; throw error; }, async () => { assert.fail("must not wait"); });
    await assert.rejects(run("one")); await assert.rejects(run("two"));
    assert.equal(calls, 1);
  }
});

test("Google quota metadata is classified without exposing its error body", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "private provider error", details: [
    { violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { retryDelay: "59s" },
  ] } }, { status: 429 });
  try {
    await assert.rejects(fetchEngineAnswer("gemini", "which tool", "test", deadline()), (error: unknown) => {
      assert.ok(error instanceof ProviderRequestError);
      assert.equal(error.reason, "quota_exhausted");
      assert.equal(error.retryAfterMs, 59_000);
      assert.ok(!error.message.includes("private")); return true;
    });
  } finally { globalThis.fetch = original; }
});

test("deadline cancellation prevents retries after the scan has ended", async () => {
  const controller = new AbortController(); let calls = 0;
  const run = createEngineRunner("gemini", "test", controller.signal, async () => { calls++; throw new ProviderRequestError("rate_limit", 429); }, async () => { controller.abort(); });
  await assert.rejects(run("one")); assert.equal(calls, 1);
});

test("partial answers and failed searches cannot become scored brand absences", () => {
  assert.throws(() => readClaudeAnswer({ stop_reason: "max_tokens", content: [{ type: "text", text: "Partial" }] }));
  assert.throws(() => readClaudeAnswer({ stop_reason: "end_turn", content: [{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }, { type: "text", text: "Partial" }] }));
  assert.throws(() => readOpenAIAnswer({ status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: "Partial" }] }] }));
  assert.throws(() => readGeminiAnswer({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "Partial" }] } }] }));
  assert.throws(() => readPerplexityAnswer({ choices: [{ finish_reason: "length", message: { content: "Partial" } }] }));
});
