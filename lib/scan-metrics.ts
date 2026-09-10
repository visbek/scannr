import type { EngineResult, PromptResult, Category } from "../components/scanner/types";

export const ENGINE_KEYS = ["gemini", "claude", "chatgpt", "perplexity"] as const;
export const CATEGORIES: Category[] = ["informational", "discovery", "commercial", "transactional"];
export const ENGINE_WEIGHTS = { gemini: 0.15, claude: 0.25, chatgpt: 0.25, perplexity: 0.35 };
export const METHODOLOGY_VERSION = "answer-visibility-v2";

// Missing statuses are supported only for reports saved by the previous release.
export function isSuccessful(result: EngineResult | undefined) {
  return !!result && (result.status === "success" || result.status === undefined);
}

export function calculateScores(results: PromptResult[], promptWeights: number[]) {
  const engines = Object.fromEntries(ENGINE_KEYS.map((key) => {
    let denominator = 0;
    let numerator = 0;
    let successful = 0;
    for (let i = 0; i < results.length; i++) {
      const check = results[i][key];
      if (!isSuccessful(check)) continue;
      successful++;
      const weight = promptWeights[i] ?? 1;
      denominator += weight;
      if (check.appeared) numerator += weight;
    }
    const rawScore = denominator > 0 ? numerator / denominator : null;
    return [key, {
      score: rawScore === null ? null : Math.round(rawScore * 100),
      rawScore, available: successful > 0, weight: ENGINE_WEIGHTS[key],
      successful, attempted: results.length,
    }];
  })) as Record<typeof ENGINE_KEYS[number], {
    score: number | null; rawScore: number | null; available: boolean;
    weight: number; successful: number; attempted: number;
  }>;
  let denominator = 0;
  let numerator = 0;
  for (const key of ENGINE_KEYS) {
    const engine = engines[key];
    if (engine.rawScore === null) continue;
    const weight = Math.round(engine.weight * 100);
    denominator += weight;
    numerator += engine.rawScore * weight;
  }
  const categoryScores = Object.fromEntries(CATEGORIES.map((category) => {
    const checks = results.filter((r) => r.category === category)
      .flatMap((r) => ENGINE_KEYS.map((key) => r[key])).filter(isSuccessful);
    return [category, { appeared: checks.filter((r) => r.appeared).length, total: checks.length }];
  })) as Record<Category, { appeared: number; total: number }>;
  const successful = ENGINE_KEYS.reduce((n, key) => n + engines[key].successful, 0);
  return {
    overallScore: denominator > 0 ? Math.round(numerator / denominator * 100) : null,
    engines, categoryScores,
    coverage: { successful, total: results.length * ENGINE_KEYS.length },
  };
}

// Compare all brands on exactly the same successful answer/engine pairs.
export function compareBrands(brands: Record<string, PromptResult[]>, weights: number[]) {
  const all = Object.values(brands);
  const masked = Object.fromEntries(Object.entries(brands).map(([domain, rows]) => [domain,
    rows.map((row, i) => ({ ...row, ...Object.fromEntries(ENGINE_KEYS.map((key) => [key,
      all.every((results) => isSuccessful(results[i]?.[key]))
        ? row[key] : { appeared: false, snippet: "", status: "unverified" as const },
    ])) })),
  ])) as Record<string, PromptResult[]>;
  return Object.fromEntries(Object.entries(masked).map(([domain, rows]) => [domain, calculateScores(rows, weights)]));
}

export function summarizeFactChecks(results: PromptResult[]) {
  const cited = results.flatMap((r) => ENGINE_KEYS.map((key) => r[key])).filter((r) => r.appeared);
  const checked = cited.filter((r) => typeof r.factCheck?.accurate === "boolean");
  const wrong = checked.filter((r) => r.factCheck?.accurate === false);
  return {
    totalCited: cited.length, checked: checked.length,
    accurate: wrong.length ? false : cited.length > 0 && checked.length === cited.length ? true : null,
    issues: [...new Set(wrong.map((r) => r.factCheck?.issue || "A description may be incorrect; review the answer."))].slice(0, 3),
  };
}

export function citesDomain(urls: string[], domain: string) {
  return urls.some((url) => {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      return ["http:", "https:"].includes(parsed.protocol) && hostname === domain.toLowerCase().replace(/^www\./, "");
    } catch { return false; }
  });
}

export function parseVerification(text: string) {
  const [answer, sentiment] = text.trim().toUpperCase().split(/\r?\n/).map((s) => s.trim());
  if (!["YES", "PARTIAL", "NO"].includes(answer)) return { verified: null };
  return {
    verified: answer !== "NO",
    sentiment: answer !== "NO" && ["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(sentiment)
      ? sentiment.toLowerCase() as "positive" | "neutral" | "negative" : undefined,
  };
}

export function parseFactCheck(text: string) {
  const [answer, ...rest] = text.trim().split(/\r?\n/).map((s) => s.trim());
  if (answer.toUpperCase() === "ACCURATE") return { accurate: true };
  if (answer.toUpperCase() === "INACCURATE") return { accurate: false, issue: rest.join(" ") || undefined };
  return { accurate: null };
}
