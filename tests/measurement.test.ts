import test from "node:test";
import assert from "node:assert/strict";
import { calculateScores, compareBrands, summarizeFactChecks, citesDomain, parseFactCheck, parseVerification } from "../lib/scan-metrics";
import { readClaudeAnswer, readGeminiAnswer, readOpenAIAnswer, readPerplexityAnswer } from "../lib/scan-evidence";
import type { EngineResult, PromptResult } from "../components/scanner/types";

const check = (appeared: boolean, status: EngineResult["status"] = "success"): EngineResult => ({ appeared, status, snippet: "" });
const row = (gemini: EngineResult, claude = check(false, "unavailable")): PromptResult => ({
  prompt: "best workspace", category: "discovery", gemini, claude,
  chatgpt: check(false, "unavailable"), perplexity: check(false, "unavailable"),
});

test("a provider outage does not turn a successful citation into a lower score", () => {
  const result = calculateScores([row(check(true)), row(check(false, "failed")), row(check(false, "unverified"))], [1, 1, 1]);
  assert.equal(result.overallScore, 100);
  assert.equal(result.engines.gemini.successful, 1);
  assert.deepEqual(result.categoryScores.discovery, { appeared: 1, total: 1 });
  assert.deepEqual(result.coverage, { successful: 1, total: 12 });
});

test("a real absence is zero; a total outage has no score", () => {
  assert.equal(calculateScores([row(check(false))], [1]).overallScore, 0);
  const failed = calculateScores([row(check(false, "failed"), check(false, "failed"))], [1]);
  assert.equal(failed.overallScore, null);
  assert.equal(failed.engines.gemini.score, null);
  assert.equal(failed.categoryScores.discovery.total, 0);
});

test("engine weights are normalized over successful engines", () => {
  assert.equal(calculateScores([row(check(true), check(false))], [1]).overallScore, 38);
});

test("competitors share the exact same comparison denominator", () => {
  const main = [row(check(true)), row(check(false))];
  const competitor = [row(check(true)), row(check(false, "unverified"))];
  const result = compareBrands({ "example.com": main, "other.com": competitor }, [1, 0.3]);
  assert.equal(result["example.com"].overallScore, 100);
  assert.equal(result["other.com"].overallScore, 100);
  assert.deepEqual(result["example.com"].coverage, result["other.com"].coverage);
  assert.equal(result["example.com"].coverage.successful, 1);
  assert.equal(calculateScores(main, [1, 0.3]).overallScore, 77);
});

test("fact-check failures and malformed answers never become accurate", () => {
  assert.equal(parseVerification("I think YES").verified, null);
  assert.equal(parseVerification("NO").verified, false);
  assert.equal(parseVerification("PARTIAL\nNEGATIVE").sentiment, "negative");
  assert.equal(parseFactCheck("Unable to check").accurate, null);
  const cited = row({ ...check(true), factCheck: { accurate: null } });
  assert.equal(summarizeFactChecks([cited]).accurate, null);
  cited.gemini.factCheck = { accurate: false };
  const summary = summarizeFactChecks([cited]);
  assert.equal(summary.accurate, false);
  assert.equal(summary.issues.length, 1);
  cited.gemini.factCheck = { accurate: true };
  assert.equal(summarizeFactChecks([cited]).accurate, true);
  assert.equal(summarizeFactChecks([row(check(false))]).accurate, null);
});

test("a search result is not a Claude answer citation", () => {
  const answer = readClaudeAnswer({ content: [
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com", title: "Example" }] },
    { type: "text", text: "Choose a workspace that suits you." },
  ] });
  assert.equal(answer.citations.length, 0);
  assert.equal(answer.text.includes("Example"), false);
  const cited = readClaudeAnswer({ content: [{ type: "text", text: "A useful guide.", citations: [{ url: "https://example.com" }] }] });
  assert.equal(citesDomain(cited.citations, "example.com"), true);
});

test("Gemini sources require grounding support; all answer parts are read", () => {
  const answer = readGeminiAnswer({ candidates: [{
    content: { parts: [{ text: "Part one." }, { text: "Part two." }] },
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com" } }, { web: { uri: "https://other.com" } }],
      groundingSupports: [{ groundingChunkIndices: [1] }],
    },
  }] });
  assert.equal(answer.text, "Part one.\nPart two.");
  assert.equal(citesDomain(answer.citations, "example.com"), false);
  assert.equal(citesDomain(answer.citations, "other.com"), true);
});

test("citation URLs match hosts, including bare roots and query strings", () => {
  for (const url of ["https://example.com", "https://www.example.com?ref=ai", "https://example.com/guide"]) {
    assert.equal(citesDomain([url], "example.com"), true);
  }
  for (const url of ["https://example.com.evil.test", "https://example.com@evil.test", "https://evil.test/example.com", "javascript:example.com"]) {
    assert.equal(citesDomain([url], "example.com"), false);
  }
});

test("provider parsers reject an empty response instead of scoring it as absent", () => {
  for (const parse of [readClaudeAnswer, readGeminiAnswer, readOpenAIAnswer, readPerplexityAnswer]) {
    assert.throws(() => parse({}), /no final answer/);
  }
  assert.equal(citesDomain(readOpenAIAnswer({ output: [{ type: "message", content: [{ type: "output_text", text: "Read https://example.com." }] }] }).citations, "example.com"), true);
});
