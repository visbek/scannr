import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../app/api/reports/[id]/route";
import { reportSession, saveReport } from "../lib/report-store";
import { restoreReport, type SavedScanRow } from "../lib/report-snapshot";

const id = "11111111-1111-4111-8111-111111111111";
const saved: SavedScanRow = {
  id, domain: "example.com", score: 35, created_at: "2026-09-01T10:00:00Z",
  gemini_score: 35, claude_score: null, chatgpt_score: null, perplexity_score: null,
  icp_data: { companyName: "Example" }, results: [],
};

test("legacy reports retain their historical score and date", () => {
  const result = restoreReport(saved);
  assert.equal(result.legacy, true);
  assert.equal(result.report.overallScore, 35);
  assert.equal(result.report.createdAt, saved.created_at);
  assert.equal(result.report.engines.claude.score, null);
  assert.equal(result.report.factCheckSummary, undefined);
});

test("versioned snapshots preserve report content and keywords", () => {
  const report = restoreReport(saved).report;
  report.methodologyVersion = "answer-visibility-v2";
  report.competitorResults = { "other.com": { domain: "other.com", score: 20, appeared: 2, total: 10 } };
  const keywordsData = { tier1: [], tier2: [], tier3: [] };
  const restored = restoreReport({ ...saved, results: { version: 2, report, keywordsData } });
  assert.equal(restored.legacy, false);
  assert.deepEqual(restored.report.competitorResults, report.competitorResults);
  assert.deepEqual(restored.keywordsData, keywordsData);
});

test("saved report API authenticates, filters ownership and never calls AI", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://reports.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.hostname, "reports.test", "no provider request is allowed when viewing reports");
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    if (url.pathname === "/auth/v1/user") {
      if (auth === "Bearer expired") return Response.json({ msg: "Expired" }, { status: 401 });
      return Response.json({ id: auth === "Bearer owner-token" ? "owner" : "other", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: saved.created_at });
    }
    assert.equal(url.pathname, "/rest/v1/scans");
    assert.equal(url.searchParams.get("id"), `eq.${id}`);
    assert.equal(url.searchParams.get("user_id"), auth === "Bearer owner-token" ? "eq.owner" : "eq.other");
    return Response.json(auth === "Bearer owner-token" ? saved : null);
  };
  try {
    const request = (token?: string) => new NextRequest(`https://app.test/api/reports/${id}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const context = { params: Promise.resolve({ id }) };
    assert.equal((await GET(request(), context)).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await GET(request("expired"), context)).status, 401);
    assert.equal((await GET(request("other-token"), context)).status, 404);
    const response = await GET(request("owner-token"), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).score, 35);
  } finally { globalThis.fetch = original; }
});

test("server saving writes a full snapshot under the authenticated owner", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://reports.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "reports.test");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer owner-token");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: saved.created_at });
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.user_id, "owner");
    assert.equal(body.results.version, 2);
    assert.equal(body.results.report.domain, "example.com");
    assert.equal(body.claude_score, null);
    writes++;
    return Response.json({ id });
  };
  try {
    const session = await reportSession("Bearer owner-token");
    assert.ok(session);
    assert.equal(await saveReport(session, restoreReport(saved).report, null), id);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});
