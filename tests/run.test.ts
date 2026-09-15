import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../app/api/scan/run/route";

const input = {
  domain: "example.com",
  businessProfile: { companyName: "Example", whatTheySell: "", industry: "software" },
  prompts: { discovery: ["Which tools help a small team?"] },
  brandVariations: ["Example"],
};
let requestNumber = 0;
function request(body: unknown, token?: string) {
  return new NextRequest("https://app.test/api/scan/run", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `test-${++requestNumber}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

test("run API rejects excessive work before making external requests", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No external work should start"); };
  try {
    assert.equal((await POST(request({ ...input, competitors: ["a.com", "b.com", "c.com", "d.com"] }))).status, 400);
    assert.equal((await POST(request({ ...input, prompts: { discovery: Array(7).fill("Which tools?") } }))).status, 400);
  } finally { globalThis.fetch = original; }
});

test("run API reuses duplicate questions and competitor answers and saves usage before returning", async () => {
  const original = globalThis.fetch;
  const env = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://reports.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  let providerCalls = 0;
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    const address = new URL(String(url));
    if (address.hostname === "reports.test") {
      if (address.pathname === "/auth/v1/user") return Response.json({ id: "owner", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01" });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.user_id, "owner");
      assert.equal(body.results.report.overallScore, 100);
      assert.equal(body.results.report.competitorResults["rival.com"].score, 100);
      assert.equal(body.results.report.engines.claude.score, null);
      writes++;
      return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
    }
    if (address.hostname === "generativelanguage.googleapis.com") {
      providerCalls++;
      return Response.json({ candidates: [{ content: { parts: [{ text: "Two useful choices are https://example.com and https://rival.com." }] } }] });
    }
    throw new Error("Unexpected external endpoint");
  };
  try {
    const response = await POST(request({ ...input, prompts: { discovery: ["Which tools help a small team?", "Which tools help a small team?"] }, competitors: ["rival.com"] }, "owner-token"));
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(providerCalls, 1, "duplicate questions and competitors must reuse the answer");
    assert.equal(report.usage.events.length, 1);
    assert.equal(report.usage.events[0].provider, "gemini");
    assert.equal(report.usage.reused["duplicate-prompt"], 4);
    assert.equal(writes, 1, "persistence must finish before the response");
    assert.equal(report.saveStatus, "saved");
    assert.equal(report.keywordsData.source, "scan-prompts");
    assert.equal(report.keywordsData.tier2.length, 1, "failed keyword research reuses and deduplicates existing questions");
    assert.equal(report.keywordsData.tier2[0].llmPotential, "Not assessed");
    assert.equal(report.comparisonScore, 100);
    assert.deepEqual(report.coverage, { successful: 2, total: 8 });
    assert.equal(report.results[0].gemini.sentiment, undefined, "failed verification must not invent sentiment");
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});

test("run API keeps results available when saving fails; all unavailable is not zero", async () => {
  const original = globalThis.fetch;
  const env = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://reports.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  for (const key of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PERPLEXITY_API_KEY"]) delete process.env[key];
  globalThis.fetch = async (url) => {
    const address = new URL(String(url));
    assert.equal(address.hostname, "reports.test");
    return address.pathname === "/auth/v1/user"
      ? Response.json({ id: "owner", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01" })
      : Response.json({ message: "Write failed" }, { status: 403 });
  };
  try {
    const response = await POST(request(input, "owner-token"));
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.saveStatus, "failed");
    assert.equal(report.overallScore, null);
    assert.deepEqual(report.coverage, { successful: 0, total: 4 });
    assert.equal(report.factCheckSummary.accurate, null);
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});

test("Gemini quota stops queued checks while other engines finish and failed checks stay unscored", async () => {
  const original = globalThis.fetch, env = { ...process.env };
  process.env.GEMINI_API_KEY = "test"; process.env.OPENAI_API_KEY = "test";
  delete process.env.ANTHROPIC_API_KEY; delete process.env.PERPLEXITY_API_KEY;
  let gemini = 0, openai = 0;
  globalThis.fetch = async (url) => {
    const host = new URL(String(url)).hostname;
    if (host === "generativelanguage.googleapis.com") {
      gemini++;
      return Response.json({ error: { details: [{ retryDelay: "60s" }] } }, { status: 429 });
    }
    if (host === "api.openai.com") {
      openai++;
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Consider your needs and compare pricing." }] }] });
    }
    throw new Error("Unexpected network request");
  };
  try {
    const response = await POST(request({ ...input, prompts: { discovery: Array.from({ length: 6 }, (_, i) => `Which tools support use case ${i}?`) } }));
    const report = await response.json();
    assert.equal(response.status, 200);
    assert.equal(gemini, 1, "queued Gemini requests must stop after the quota response");
    assert.equal(openai, 6, "a Gemini outage must not stop another provider");
    assert.deepEqual(report.coverage, { successful: 6, total: 24 });
    assert.equal(report.engines.gemini.score, null);
    assert.equal(report.engines.chatgpt.score, 0);
    assert.match(report.engineWarnings.gemini, /rate limit/);
    assert.equal(report.methodologyVersion, "answer-visibility-v3-bounded");
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
