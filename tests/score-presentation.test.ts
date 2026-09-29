import test from "node:test";
import assert from "node:assert/strict";
import { hasCompleteCoverage, scoreLabel, scoreMessage } from "../lib/score-presentation";

test("partial scans never imply low or high overall visibility", () => {
  for (const score of [0, 13, 50, 100]) {
    for (const successful of [1, 24, 95]) {
      const data = { overallScore: score, coverage: { successful, total: 96 } };
      assert.equal(hasCompleteCoverage(data), false);
      assert.match(scoreMessage(data), /Partial scan — insufficient coverage/);
      assert.match(scoreLabel(data), /Provisional/);
    }
  }
});

test("complete scans retain their score interpretation including genuine zero visibility", () => {
  for (const [overallScore, expected] of [[0, "Nearly invisible"], [50, "Partial AI visibility"], [90, "Strong AI visibility"]] as const) {
    const data = { overallScore, coverage: { successful: 96, total: 96 } };
    assert.equal(hasCompleteCoverage(data), true);
    assert.ok(scoreMessage(data).startsWith(expected));
    assert.equal(scoreLabel(data), "AI Visibility Score");
  }
});

test("missing, empty, or invalid coverage cannot produce a confident verdict", () => {
  assert.match(scoreMessage({ overallScore: 13 }), /Coverage unknown/);
  assert.match(scoreMessage({ overallScore: null, coverage: { successful: 0, total: 96 } }), /no usable checks/);
  for (const coverage of [{ successful: 0, total: 0 }, { successful: 97, total: 96 }, { successful: -1, total: 96 }, { successful: 1.5, total: 1.5 }]) {
    assert.equal(hasCompleteCoverage({ overallScore: 13, coverage }), false);
  }
});
