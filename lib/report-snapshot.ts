import type { ScanData, PromptResult, CategoryScore, Category } from "../components/scanner/types";
import type { KeywordsData } from "../components/scanner/ResultsSection";

export interface SavedScanRow {
  id: string; domain: string; score: number | null; created_at: string;
  gemini_score: number | null; claude_score: number | null;
  chatgpt_score: number | null; perplexity_score: number | null;
  icp_data: Record<string, string> | null;
  results: { version: 2; report: ScanData; keywordsData: KeywordsData | null } | PromptResult[] | null;
}

export function restoreReport(row: SavedScanRow): { report: ScanData; keywordsData: KeywordsData | null; legacy: boolean } {
  if (row.results && !Array.isArray(row.results) && row.results.version === 2) {
    return {
      report: { ...row.results.report, reportId: row.id, createdAt: row.created_at, saveStatus: "saved" },
      keywordsData: row.results.keywordsData ?? null, legacy: false,
    };
  }
  const profile = row.icp_data ?? {};
  const results = Array.isArray(row.results) ? row.results : [];
  const engines = {
    gemini: { score: row.gemini_score, available: row.gemini_score !== null },
    claude: { score: row.claude_score, available: row.claude_score !== null },
    chatgpt: { score: row.chatgpt_score, available: row.chatgpt_score !== null },
    perplexity: { score: row.perplexity_score, available: row.perplexity_score !== null },
  };
  const categoryScores = Object.fromEntries((["informational", "discovery", "commercial", "transactional"] as Category[]).map((category) => {
    const checks = results.filter((r) => r.category === category)
      .flatMap((r) => (Object.keys(engines) as (keyof typeof engines)[]).filter((key) => engines[key].available).map((key) => r[key])).filter(Boolean);
    return [category, { appeared: checks.filter((r) => r.appeared).length, total: checks.length }];
  })) as Record<Category, CategoryScore>;
  return {
    legacy: true, keywordsData: null,
    report: {
      reportId: row.id, domain: row.domain, createdAt: row.created_at, saveStatus: "saved",
      overallScore: row.score, engines, categoryScores, results,
      methodologyVersion: "legacy",
      businessProfile: {
        companyName: profile.companyName || row.domain, whatTheySell: profile.whatTheySell || "",
        industry: profile.industry || "", geography: profile.geography || "", businessModel: profile.businessModel || "",
      },
      icp: { primaryBuyer: profile.primaryBuyer || "", buyerLocation: "", buyerCompanySize: "", buyerPainPoint: "", buyerContext: "" },
    },
  };
}
