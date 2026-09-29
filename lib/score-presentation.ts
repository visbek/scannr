import type { ScanData } from "../components/scanner/types";

type ScoreData = Pick<ScanData, "overallScore" | "coverage">;

// Only interpret an overall score when every planned check is usable.
// Older reports without coverage retain their number but not a verdict.
export function hasCompleteCoverage({ coverage, overallScore }: ScoreData) {
  return overallScore !== null && !!coverage &&
    Number.isInteger(coverage.total) && coverage.total > 0 &&
    Number.isInteger(coverage.successful) && coverage.successful === coverage.total;
}

export function scoreMessage(data: ScoreData) {
  if (data.overallScore === null || data.coverage?.successful === 0) {
    return "Scan unavailable — no usable checks";
  }
  if (!data.coverage) return "Coverage unknown — overall assessment unavailable";
  if (!hasCompleteCoverage(data)) {
    return "Partial scan — insufficient coverage for a reliable overall assessment";
  }
  if (data.overallScore > 66) return "Strong AI visibility";
  if (data.overallScore >= 33) return "Partial AI visibility";
  return "Nearly invisible in AI search";
}

export function scoreLabel(data: ScoreData) {
  return hasCompleteCoverage(data) ? "AI Visibility Score" : "Provisional score · usable checks only";
}
