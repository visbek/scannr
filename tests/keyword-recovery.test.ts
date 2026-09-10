import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { keywordsFromPrompts, KEYWORD_FALLBACK_NOTE } from "../lib/keyword-fallback";
import { ResultsSection } from "../components/scanner/ResultsSection";
import { makeDemoReport } from "../lib/demo-report";

test("keyword recovery retains original questions and intent without guessing metrics or making requests", () => {
  const result = keywordsFromPrompts([
    { category: "transactional", prompt: "Rent an office in Vizag" },
    { category: "commercial", prompt: "Compare office plans in Vizag" },
    { category: "discovery", prompt: "Compare office plans in Vizag" },
    { category: "informational", prompt: "What is a managed office?" },
  ]);
  assert.equal(result.source, "scan-prompts");
  assert.deepEqual([result.tier1.length, result.tier2.length, result.tier3.length], [1, 1, 1]);
  assert.equal(result.tier1[0].keyword, "Rent an office in Vizag");
  for (const item of [...result.tier1, ...result.tier2, ...result.tier3]) {
    assert.equal(item.searchVolume, "Not measured");
    assert.equal(item.llmPotential, "Not assessed");
  }
});

test("missing keyword data renders intent tabs, recovery provenance and the email gate", () => {
  const props = { scanData: makeDemoReport("partial"), keywordsData: null, keywordsLoading: false,
    emailCaptured: false, emailInput: "", emailFocused: false, emailSubmitting: false, showToast: false,
    onEmailChange: () => {}, onEmailFocus: () => {}, onEmailSubmit: () => {}, sectionRef: { current: null } };
  const locked = renderToStaticMarkup(React.createElement(ResultsSection, props));
  for (const label of ["High Intent", "Mid Intent", "Awareness", "Get My Full Report", "checks usable for scoring", "This score is incomplete"])
    assert.ok(locked.includes(label), label);
  assert.ok(locked.includes("Additional keyword research is unavailable"));
  const unlocked = renderToStaticMarkup(React.createElement(ResultsSection, { ...props, emailCaptured: true }));
  assert.ok(!unlocked.includes("Get My Full Report"));
  assert.ok(unlocked.includes("Not assessed"));
  assert.ok(KEYWORD_FALLBACK_NOTE.includes("not independently researched"));
});
