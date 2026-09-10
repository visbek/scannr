import test from "node:test";
import assert from "node:assert/strict";
import { generateKeywords } from "../lib/scan-keywords";

test("keyword research uses the buyer market and never reports model guesses as search volume", async () => {
  process.env.SCANRR_CACHE_MODE = "memory";
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousSerperKey = process.env.SERPER_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.SERPER_API_KEY = "test-key";
  const queries: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "google.serper.dev") {
      queries.push(JSON.parse(String(init?.body)).q);
      return Response.json({ organic: [], peopleAlsoAsk: [] });
    }
    if (url.hostname.endsWith("reddit.com")) return Response.json({ data: { children: [] } });
    assert.equal(url.hostname, "api.anthropic.com");
    return Response.json({ content: [{ type: "text", text: JSON.stringify({
      tier1: [{ keyword: "onboarding software UK", searchVolume: "High", llmPotential: "Medium", why: "Candidate for evaluation" }], tier2: [], tier3: [],
    }) }] });
  };
  try {
    const result = await generateKeywords({ domain: "example.com", industry: "software", companyName: "Example", whatTheySell: "onboarding software", buyerLocation: "UK" });
    assert.ok(queries.some((query) => query.includes("UK")));
    assert.ok(queries.every((query) => !/supplier india/i.test(query)));
    assert.equal(result.tier1[0].searchVolume, "Not measured");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousSerperKey === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = previousSerperKey;
  }
});
