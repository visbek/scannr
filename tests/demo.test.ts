import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { makeDemoReport } from "../lib/demo-report";

test("demo blocks live routes and write actions even when provider keys exist", () => {
  const previous = process.env.SCANRR_DEMO;
  process.env.SCANRR_DEMO = "1";
  try {
    for (const path of ["/api/scan/run", "/api/scan/generate-prompts", "/api/leads/capture", "/api/reports/123", "/login"]) {
      assert.equal(proxy(new NextRequest(`http://localhost:3000${path}`)).status, 403);
    }
    assert.equal(proxy(new NextRequest("http://localhost:3000/demo", { method: "POST" })).status, 403);
    assert.equal(proxy(new NextRequest("http://localhost:3000/demo")).headers.get("x-middleware-next"), "1");
    assert.equal(proxy(new NextRequest("http://localhost:3000/")).headers.get("location"), "http://localhost:3000/demo");
    process.env.SCANRR_DEMO = "0";
    assert.equal(proxy(new NextRequest("http://localhost:3000/api/scan/run")).headers.get("x-middleware-next"), "1");
  } finally {
    if (previous === undefined) delete process.env.SCANRR_DEMO; else process.env.SCANRR_DEMO = previous;
  }
});

test("demo uses real scoring functions and distinguishes missing checks from absence", () => {
  assert.equal(makeDemoReport("unavailable").overallScore, null);
  assert.equal(makeDemoReport("complete").coverage?.successful, 16);
  const partial = makeDemoReport("partial");
  assert.equal(partial.coverage?.successful, 11);
  assert.equal(partial.engines.perplexity.score, null);
  assert.equal(partial.factCheckSummary?.accurate, null);
});
