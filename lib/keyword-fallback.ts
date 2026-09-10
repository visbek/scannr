import type { PromptResult } from "../components/scanner/types";
import type { KeywordsData } from "../components/scanner/ResultsSection";

export const KEYWORD_FALLBACK_NOTE = "Additional keyword research is unavailable. These suggestions reuse this scan's buyer questions, grouped by intent. They are not independently researched keywords; search volume and citation potential have not been measured.";

// Recovery must never start another paid request or invent replacement evidence.
export function keywordsFromPrompts(rows: Pick<PromptResult, "prompt" | "category">[]): KeywordsData {
  const result: KeywordsData = { tier1: [], tier2: [], tier3: [], source: "scan-prompts" };
  const seen = new Set<string>();
  for (const row of rows.slice(0, 24)) {
    const keyword = row.prompt.trim();
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    seen.add(keyword.toLowerCase());
    const tier = row.category === "transactional" ? "tier1"
      : row.category === "commercial" || row.category === "discovery" ? "tier2" : "tier3";
    result[tier].push({ keyword, searchVolume: "Not measured", llmPotential: "Not assessed",
      why: "Buyer question already generated for this scan. Review its relevance before creating content." });
  }
  return result;
}
