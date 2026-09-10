import { calculateScores, compareBrands, summarizeFactChecks, CATEGORIES, ENGINE_KEYS } from "./scan-metrics";
import type { EngineResult, PromptResult, ScanData } from "../components/scanner/types";

export type DemoScenario = "partial" | "unavailable" | "complete";
export function makeDemoReport(scenario: DemoScenario): ScanData {
  const questions = ["How can a small team manage customer onboarding?", "Which onboarding tools suit a small B2B team?", "What should I compare when choosing onboarding software?", "Which onboarding tools offer a monthly plan?"];
  const results: PromptResult[] = questions.map((prompt, i) => {
    const checks = Object.fromEntries(ENGINE_KEYS.map((key, j) => {
      const status: EngineResult["status"] = scenario === "unavailable" ? "failed"
        : scenario === "partial" && key === "perplexity" ? "unavailable"
        : scenario === "partial" && key === "claude" && i === 1 ? "unverified" : "success";
      const appeared = status === "success" && (i + j) % 3 === 0;
      return [key, { status, appeared, snippet: appeared ? "SAMPLE ANSWER: Example Company offers onboarding software for small teams." : "",
        ...(appeared ? { sentiment: "neutral" as const, factCheck: { accurate: scenario === "partial" ? null : true } } : {}),
      }];
    }));
    return { prompt, category: CATEGORIES[i], ...checks } as PromptResult;
  });
  const rival = results.map((row, i) => ({ ...row, ...Object.fromEntries(ENGINE_KEYS.map((key, j) => [key, {
    ...row[key], appeared: row[key].status === "success" && (i + j) % 2 === 0,
  }])) }));
  const comparison = compareBrands({ "example.com": results, "rival.example": rival }, questions.map(() => 1));
  return {
    ...calculateScores(results, questions.map(() => 1)), results,
    domain: "example.com", methodologyVersion: "DEMO — synthetic sample, not a live measurement",
    createdAt: "2026-09-09T00:00:00Z",
    businessProfile: { companyName: "DEMO — Example Company", whatTheySell: "Sample onboarding software", industry: "Software", geography: "Sample market", businessModel: "B2B SaaS" },
    icp: { primaryBuyer: "Sample marketing team", buyerLocation: "Sample market", buyerCompanySize: "10–50 employees", buyerPainPoint: "Managing onboarding", buyerContext: "Demo only" },
    factCheckSummary: summarizeFactChecks(results),
    comparisonScore: comparison["example.com"].overallScore,
    comparisonCoverage: comparison["example.com"].coverage,
    competitorResults: { "rival.example": { domain: "rival.example", score: comparison["rival.example"].overallScore,
      total: comparison["rival.example"].coverage.successful,
      appeared: Object.values(comparison["rival.example"].categoryScores).reduce((sum, category) => sum + category.appeared, 0) } },
  };
}
