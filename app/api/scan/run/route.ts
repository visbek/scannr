import { providerFetch, measuredRoute, usageSnapshot, noteReuse } from "@/lib/scan-usage";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import type { EngineResult, PromptResult, ScanData, ICP, TrustSignals } from "@/components/scanner/types";
import { calculateScores, compareBrands, summarizeFactChecks, citesDomain, parseVerification, parseFactCheck, isSuccessful, ENGINE_KEYS, METHODOLOGY_VERSION } from "@/lib/scan-metrics";
import { readClaudeAnswer, readGeminiAnswer, readOpenAIAnswer, readPerplexityAnswer, type AnswerEvidence } from "@/lib/scan-evidence";

import { reportSession, saveReport } from "@/lib/report-store";
import { generateKeywords } from "@/lib/scan-keywords";
import { keywordsFromPrompts } from "@/lib/keyword-fallback";
import type { KeywordsData } from "@/components/scanner/ResultsSection";

export const maxDuration = 300;

// ─── IP rate limiting ─────────────────────────────────────────────────────────

interface RateLimitEntry { count: number; resetTime: number }
const runRateLimitMap = new Map<string, RateLimitEntry>();
const RUN_RATE_LIMIT_MAX = 3;
const RUN_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function checkRunRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = runRateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    runRateLimitMap.set(ip, { count: 1, resetTime: now + RUN_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RUN_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function normalizeDomain(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim();
}

// Common short words that are brand prefixes but also appear in unrelated English words
const AMBIGUOUS_PREFIXES = new Set([
  'eco', 'bio', 'green', 'smart', 'go', 'my',
  'pro', 'meta', 'neo', 'max', 'plus', 'prime',
  'one', 'now', 'live', 'next', 'true', 'pure',
  'franchise', 'world', 'global', 'group', 'brand', 'media',
  'digital', 'agency', 'studio', 'house', 'works', 'force',
  'point', 'space', 'place', 'market', 'trade', 'direct',
  'first', 'quick', 'rapid', 'swift', 'clear',
  'bright', 'light', 'fresh', 'clean', 'safe', 'sure',
  'total', 'ultra', 'super', 'micro', 'macro', 'metro',
  'urban', 'rural', 'local', 'social', 'cloud', 'data',
  'tech', 'labs', 'hub', 'base', 'core', 'edge', 'link',
  'bridge', 'reach', 'scale', 'shift', 'flow', 'spark',
  'ftw',
]);

function detectBrand(responseText: string, brandVariations: string[]): boolean {
  const found = brandVariations.find((variation) => {
    if (!variation || variation.length < 3) return false;

    // Build word-boundary pattern: spaces become flexible separators
    const escapedVariation = variation
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .trim()
      .replace(/\s+/g, "[\\s\\-\\_]*");

    if (!escapedVariation || escapedVariation.replace(/\[.*?\]\*/g, "").length < 3) return false;

    const regex = new RegExp(`(?<![a-z0-9])${escapedVariation}(?![a-z0-9])`, "i");
    if (!regex.test(responseText)) return false;

    // Extra check: if variation is a common short word (e.g. "smart", "green"),
    // require at least one non-ambiguous variation to also appear in the text
    if (AMBIGUOUS_PREFIXES.has(variation.toLowerCase())) {
      const nonAmbiguous = brandVariations.filter(
        v => v.length >= 5 && !AMBIGUOUS_PREFIXES.has(v.toLowerCase())
      );
      const fullBrandPresent = nonAmbiguous.some(v => {
        const esc = v.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, "[\\s\\-\\_]*");
        if (!esc || esc.replace(/\[.*?\]\*/g, "").length < 3) return false;
        return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i").test(responseText);
      });
      if (!fullBrandPresent) return false;
    }

    return true;
  });

  console.log("[DETECT]", found ? `FOUND: ${found}` : `NOT FOUND. Checked: ${brandVariations.join(", ")}`);

  return !!found;
}

// LLM verification pass — runs only when detectBrand() already found a candidate match,
// to reject false positives like a generic word inside the brand name (e.g. "franchise").
async function verifyBrandMention(
  responseText: string,
  companyName: string,
  domain: string,
  brandVariations: string[],
  signal?: AbortSignal
): Promise<{ verified: boolean | null; sentiment?: "positive" | "neutral" | "negative" }> {
  try {
    const client = new Anthropic({ fetch: providerFetch("verification"), apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 12_000 });

    const prompt = `You are checking whether an AI response specifically mentions a brand AND how it's portrayed.

Brand: "${companyName}" (domain: ${domain})
Also check for: ${brandVariations.slice(0, 5).join(", ")}

AI Response:
"""
${responseText.slice(0, 3000)}
"""

Answer with exactly this format on two lines:
Line 1: YES, NO, or PARTIAL (is the brand specifically named/cited/recommended?)
Line 2 (only if YES or PARTIAL): POSITIVE, NEUTRAL, or NEGATIVE (how is the brand portrayed?)

Rules for line 1:
- YES: brand explicitly named or its URL referenced as a resource/solution
- NO: response only uses generic industry words from the brand name
- PARTIAL: brand mentioned but not as primary recommendation

Rules for line 2:
- POSITIVE: recommended, praised, listed as top choice
- NEUTRAL: mentioned factually without strong endorsement or criticism
- NEGATIVE: criticized, warned against, or portrayed negatively`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    }, { signal });

    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return parseVerification(text);
  } catch (err) {
    console.error("[verifyBrandMention] error:", err);
    // A failed verifier is unknown, never a confirmed mention.
    return { verified: null };
  }
}

// Runs only once a citation is already confirmed — checks whether what the AI
// said about the brand in that citation is actually true.
async function factCheckMention(
  responseText: string,
  snippet: string,
  companyName: string,
  domain: string,
  whatTheySell: string,
  signal?: AbortSignal
): Promise<{ accurate: boolean | null; issue?: string }> {
  try {
    const client = new Anthropic({ fetch: providerFetch("description-check"), apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 12_000 });

    const prompt = `You are fact-checking what an AI engine said about a specific brand.

Brand: "${companyName}" (${domain})
What they actually sell: "${whatTheySell}"

What the AI engine said about them:
"""
${snippet.slice(0, 1000)}
"""

Is what the AI said about ${companyName} factually accurate?
Check for:
- Wrong description of what they do
- Wrong location or market
- Outdated information that sounds wrong
- Confusing them with another company

Respond with exactly this format and nothing else — no labels, no
prefixes, no numbering:
First line: the single word ACCURATE or INACCURATE
Second line (only if INACCURATE): one plain sentence describing the
specific error. Do not prefix it with "Line 2" or any other label.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      messages: [{ role: "user", content: prompt }],
    }, { signal });

    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return parseFactCheck(text);
  } catch (err) {
    console.error("[factCheckMention] error:", err);
    // Keep missing evidence distinct from a completed consistency check.
    return { accurate: null };
  }
}

// Shape actually produced by generate-prompts/route.ts (via research/route.ts's TrustSignals) —
// nested per-source objects, not a flat boolean map.
interface IncomingTrustSignals {
  trustpilot?: { exists: boolean };
  g2?: { exists: boolean };
  capterra?: { exists: boolean };
  faqPage?: { exists: boolean };
  pressmentions?: { exists: boolean };
  redditMentions?: { exists: boolean };
  medium?: { exists: boolean };
  substack?: { exists: boolean };
  youtube?: { exists: boolean };
  linkedinPage?: { exists: boolean };
}

// Flattens the nested trust signals into the simple boolean map content
// recommendations reason over.
function simplifyTrustSignals(ts?: IncomingTrustSignals): Record<string, boolean> {
  if (!ts) return {};
  return {
    "FAQ page": !!ts.faqPage?.exists,
    "Review profiles": !!(ts.trustpilot?.exists || ts.g2?.exists || ts.capterra?.exists),
    "Press mentions": !!ts.pressmentions?.exists,
    "Reddit presence": !!ts.redditMentions?.exists,
    "Medium or Substack content": !!(ts.medium?.exists || ts.substack?.exists),
    "YouTube channel": !!ts.youtube?.exists,
    "LinkedIn company page": !!ts.linkedinPage?.exists,
  };
}

async function generateContentRecommendations(
  domain: string,
  companyName: string,
  whatTheySell: string,
  industry: string,
  trustSignals: Record<string, boolean>,
  results: PromptResult[],
  overallScore: number,
  factCheckIssues: string[]
): Promise<Array<{
  priority: "high" | "medium" | "low";
  type: string;
  title: string;
  description: string;
  expectedImpact: string;
}>> {
  // Find which prompt categories had zero citations
  const missedPrompts = results
    .filter(r => ENGINE_KEYS.some(key => isSuccessful(r[key])))
    .filter(r => !r.gemini?.appeared && !r.claude?.appeared &&
                 !r.chatgpt?.appeared && !r.perplexity?.appeared)
    .map(r => r.prompt)
    .slice(0, 5);

  try {
    const client = new Anthropic({ fetch: providerFetch("recommendations"), apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 12_000 });

    const trustGaps = Object.entries(trustSignals)
      .filter(([, present]) => !present)
      .map(([key]) => key)
      .join(", ");

    const prompt = `You are an AI visibility consultant. A brand scanned their AI visibility and got a score of ${overallScore}/100.

Brand: ${companyName} (${domain})
What they sell: ${whatTheySell}
Industry: ${industry}
Missing trust signals: ${trustGaps || "none"}

Prompts with no observed citation in the completed checks (some engines may be unavailable):
${missedPrompts.map((p, i) => `${i + 1}. "${p}"`).join("\n")}
${factCheckIssues.length > 0 ? `
Accuracy problems detected in how AI engines describe this brand:
${factCheckIssues.map((i, n) => `${n + 1}. ${i}`).join("\n")}

If accuracy problems are listed above, generate at least one
"high" priority recommendation that directly fixes the specific
misrepresentation described — e.g. a clearer About/Team page stating
plainly what the business is and does, Organization/LocalBusiness
schema, or (if a specific competitor is named as a source of
confusion) a differentiation page distinguishing the two. These
identity-fix recommendations should outrank generic FAQ advice
when both apply.` : ""}

Generate up to 5 specific content recommendations supported by the observations. Return fewer if evidence is insufficient. These are proposed actions, not proven causes or guaranteed improvements. Never invent statistics, score gains, revenue forecasts, or citation percentages.
Each recommendation must be a SPECIFIC page or content piece they should create.

Return ONLY a JSON array, no other text:
[
  {
    "priority": "high",
    "type": "FAQ Page",
    "title": "Create /faq page answering top buyer questions",
    "description": "Build a dedicated FAQ page that answers the exact questions buyers ask AI engines. Include questions like: [give 2-3 specific questions based on their prompts]",
    "expectedImpact": "Make accurate answers easier to find; measure any citation change in subsequent comparable scans."
  }
]

Priority rules:
- high: missing FAQ page, no review profiles, missing from all informational prompts
- medium: missing press mentions, not in discovery prompts
- low: nice-to-have content improvements

Types to use: "FAQ Page", "Comparison Page", "Review Profile", "Press Coverage", "Case Study", "About/Team Page", "Blog Post", "Directory Listing"`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (message.content[0] as { text: string }).text.trim();
    const jsonStr = text.replace(/```json\n?|\n?```/g, "").trim();
    const recs = JSON.parse(jsonStr);
    return Array.isArray(recs) ? recs.slice(0, 5) : [];
  } catch (err) {
    console.error("[contentRecommendations] error:", err);
    // Return rule-based fallback recommendations
    const recs = [];
    if (factCheckIssues.length > 0) {
      recs.unshift({
        priority: "high" as const,
        type: "About/Team Page",
        title: `Fix how AI engines describe ${companyName}`,
        description: `AI engines are misrepresenting ${companyName}: ${factCheckIssues[0]} Publish a clear About/Team page stating plainly what the business is and does, and add Organization schema markup so AI engines pull the correct description.`,
        expectedImpact: "Clarify the business description; check subsequent answers for changes."
      });
    }
    if (trustSignals && !trustSignals["FAQ page"]) {
      recs.push({
        priority: "high" as const,
        type: "FAQ Page",
        title: `Create a /faq page on ${domain}`,
        description: `Build a FAQ page answering the top questions buyers ask about ${whatTheySell}. Use FAQPage schema markup so AI engines can extract your answers directly.`,
        expectedImpact: "Make useful answers available on the site; a citation increase is not guaranteed."
      });
    }
    if (trustSignals && !trustSignals["Review profiles"]) {
      recs.push({
        priority: "high" as const,
        type: "Review Profile",
        title: "Create profiles on G2, Trustpilot or Capterra",
        description: `AI engines heavily weight third-party review sites when recommending ${industry} solutions. Set up and actively collect reviews on at least one platform.`,
        expectedImpact: "Provide independent customer evidence; measure whether these sources are cited."
      });
    }
    if (trustSignals && !trustSignals["Press mentions"]) {
      recs.push({
        priority: "medium" as const,
        type: "Press Coverage",
        title: "Get covered on 2-3 industry publications",
        description: `Reach out to ${industry} blogs and news sites for coverage. AI engines treat press mentions as authority signals when deciding who to recommend.`,
        expectedImpact: "Add relevant third-party coverage; the effect on visibility needs measurement."
      });
    }
    return recs;
  }
}

type Category = "informational" | "discovery" | "commercial" | "transactional";

// FIX 4 — prompt quality check (brand name in prompt = low quality)
function isHighQualityPrompt(promptText: string, brandVariations: string[]): boolean {
  const lowerPrompt = promptText.toLowerCase();
  return !brandVariations.some(
    (variation) => variation.length >= 5 && lowerPrompt.includes(variation.toLowerCase())
  );
}

interface BusinessProfile {
  companyName: string;
  whatTheySell: string;
  industry: string;
  geography: string;
  businessModel: string;
}

interface FlatPrompt {
  text: string;
  category: Category;
}


function extractSnippet(text: string, brandVariations: string[]): string {
  // Find match position by mapping stripped index back to original text
  const rawLower = text.toLowerCase();
  const stripped = rawLower.replace(/[^a-z0-9]/g, "");

  let matchIndex = -1;
  for (const v of brandVariations) {
    const normalizedVariation = v.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedVariation.length < 3) continue;
    const strippedIdx = stripped.indexOf(normalizedVariation);
    if (strippedIdx === -1) continue;
    // Map stripped index back to original text position
    let count = 0;
    for (let i = 0; i < rawLower.length; i++) {
      if (/[a-z0-9]/.test(rawLower[i])) count++;
      if (count > strippedIdx) { matchIndex = i; break; }
    }
    break;
  }

  if (matchIndex === -1) return text.slice(0, 200) + (text.length > 200 ? "..." : "");
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(text.length, matchIndex + 160);
  return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
}

// Evaluate every brand against the same final answers. Search-tool results are
// deliberately excluded by the provider parsers.
async function analyzeAnswer(
  evidence: AnswerEvidence, variations: string[], companyName: string,
  domain: string, whatTheySell: string, signal?: AbortSignal
): Promise<EngineResult> {
  const citedByUrl = citesDomain(evidence.citations, domain);
  let appeared = citedByUrl;
  let status: EngineResult["status"] = "success";
  let sentiment: EngineResult["sentiment"];
  if (!citedByUrl && detectBrand(evidence.text, variations)) {
    const verification = await verifyBrandMention(evidence.text, companyName, domain, variations, signal);
    sentiment = verification.sentiment;
    if (!citedByUrl) {
      appeared = verification.verified === true;
      if (verification.verified === null) status = "unverified";
    }
  }
  const snippet = appeared ? extractSnippet(evidence.text, variations) : "";
  const factCheck = appeared && whatTheySell && snippet
    ? await factCheckMention(evidence.text, snippet, companyName, domain, whatTheySell, signal)
    : undefined;
  return { appeared, status, snippet, sentiment, factCheck, evidence };
}

async function fetchEngineAnswer(engine: typeof ENGINE_KEYS[number], prompt: string, apiKey: string, deadline: AbortSignal): Promise<AnswerEvidence> {
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(45_000)]);
  if (engine === "claude") {
    const client = new Anthropic({ fetch: providerFetch("answers.claude"), apiKey, maxRetries: 1, timeout: 45_000 });
    const message = await client.messages.create({
      model: "claude-sonnet-4-5", max_tokens: 1000, temperature: 0,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }, { signal });
    return readClaudeAnswer(message);
  }
  const config = engine === "gemini" ? {
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 }, tools: [{ googleSearch: {} }] },
  } : engine === "chatgpt" ? {
    url: "https://api.openai.com/v1/responses",
    body: { model: "gpt-4o-mini", tools: [{ type: "web_search_preview" }], input: prompt },
  } : {
    url: "https://api.perplexity.ai/chat/completions",
    body: { model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: 500, temperature: 0 },
  };
  const response = await providerFetch(`answers.${engine}`)(config.url, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", ...(engine !== "gemini" ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(config.body),
  });
  if (!response.ok) throw new Error(`${engine} request failed (${response.status})`);
  const data: unknown = await response.json();
  return engine === "gemini" ? readGeminiAnswer(data) : engine === "chatgpt" ? readOpenAIAnswer(data) : readPerplexityAnswer(data);
}

async function mapConcurrent<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      output[i] = await run(items[i], i);
    }
  }));
  return output;
}

// ─── Route handler ────────────────────────────────────────────────────────────

async function handlePost(request: NextRequest) {
  console.log("[scan/run] Route hit");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRunRateLimit(ip)) {
    return NextResponse.json(
      { error: "rate_limit", message: "Too many scans. Try again in 24 hours." },
      { status: 429 }
    );
  }

  try {
    let session;
    try { session = await reportSession(request.headers.get("authorization")); }
    catch { return NextResponse.json({ error: "Your session expired. Sign in again before scanning." }, { status: 401 }); }
    const body = await request.json();
    const {
      domain: rawDomain,
      businessProfile,
      prompts: promptsByCategory,
      brandVariations: rawBrandVariations,
      competitors,
      trustSignals,
      icp,
      businessType,
    }: {
      domain: string;
      businessProfile: BusinessProfile;
      prompts: Record<Category, string[]>;
      brandVariations?: string[];
      competitors?: string[];
      trustSignals?: TrustSignals;
      icp?: ICP;
      businessType?: ScanData["businessType"];
    } = body;

    if (!rawDomain || typeof rawDomain !== "string") {
      return NextResponse.json({ error: "domain is required" }, { status: 400 });
    }
    if (!promptsByCategory || typeof promptsByCategory !== "object") {
      return NextResponse.json({ error: "prompts object is required" }, { status: 400 });
    }

    const domain = normalizeDomain(rawDomain);
    if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
      return NextResponse.json({ error: "A valid website domain is required" }, { status: 400 });
    }
    if (competitors !== undefined && (!Array.isArray(competitors) || competitors.length > 3 ||
      competitors.some((c) => typeof c !== "string" || c.length > 253 || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(c)))) {
      return NextResponse.json({ error: "Provide up to 3 competitor domains" }, { status: 400 });
    }
    if (rawBrandVariations !== undefined && (!Array.isArray(rawBrandVariations) || rawBrandVariations.length > 30 ||
      rawBrandVariations.some((v) => typeof v !== "string" || v.length > 200))) {
      return NextResponse.json({ error: "Invalid brand variations" }, { status: 400 });
    }
    const companyName = businessProfile?.companyName?.trim() || domain.split(".")[0];

    // Use brand variations from generate-prompts; fallback to domain root if missing
    const domainRoot = domain.split(".")[0];
    const brandVariations: string[] =
      Array.isArray(rawBrandVariations) && rawBrandVariations.length > 0
        ? rawBrandVariations
        : [
            domainRoot,
            domainRoot.replace(/-/g, ""),
            companyName.toLowerCase(),
            companyName.toLowerCase().replace(/\s+/g, ""),
          ].filter((v) => v.length >= 5);

    const GENERIC_WORDS = new Set([
      "franchise","world","global","group","brand","media","digital",
      "agency","studio","house","works","force","point","space","place",
      "market","trade","direct","first","prime","quick","rapid","swift",
      "clear","bright","light","fresh","clean","safe","sure","total",
      "ultra","super","micro","macro","metro","urban","local","social",
      "cloud","data","tech","labs","hub","base","core","edge","link",
      "bridge","reach","scale","shift","flow","spark","green","smart",
      "blue","red","black","white","gold","silver","one","go","my","pro"
    ]);

    // Filter out variations that are standalone generic words
    // Keep: full compound names ("franchisetoworld"),
    //       abbreviations ("ftw"),
    //       unique coined words ("sparrwo", "bekbone")
    // Remove: generic English words that appear in unrelated content
    const filteredVariations = brandVariations.filter((v) => {
      const lower = v.toLowerCase().replace(/\s+/g, "");
      // Keep if it's the full domain root (contains multiple parts joined)
      if (lower.length >= 8) return true;
      // Keep if it's a short acronym (3-4 chars, all from brand initials)
      if (v.length <= 4 && v === v.toUpperCase()) return true;
      // Remove if it's a single generic dictionary word
      if (GENERIC_WORDS.has(v.toLowerCase().trim())) return false;
      return true;
    });

    console.log(`[scan/run] domain="${domain}" company="${companyName}"`);
    console.log(`[scan/run] brandVariations: ${JSON.stringify(brandVariations)}`);
    console.log(`[scan/run] filteredVariations: ${JSON.stringify(filteredVariations)}`);

    // Flatten prompts: informational → discovery → commercial → transactional
    const CATEGORIES: Category[] = ["informational", "discovery", "commercial", "transactional"];
    const flatPrompts: FlatPrompt[] = [];
    for (const cat of CATEGORIES) {
      const list = promptsByCategory[cat];
      if (Array.isArray(list)) {
        if (list.length > 6 || list.some((text) => typeof text !== "string" || !text.trim() || text.length > 500)) {
          return NextResponse.json({ error: "Each category supports up to 6 questions of 500 characters" }, { status: 400 });
        }
        for (const text of list) flatPrompts.push({ text, category: cat });
      }
    }

    if (flatPrompts.length === 0) {
      return NextResponse.json({ error: "prompts must be a non-empty object" }, { status: 400 });
    }

    const geminiKey = process.env.GEMINI_API_KEY ?? "";
    const claudeKey = process.env.ANTHROPIC_API_KEY ?? "";
    const openAIKey = process.env.OPENAI_API_KEY ?? "";
    const perplexityKey = process.env.PERPLEXITY_API_KEY ?? "";


    const deadline = AbortSignal.timeout(230_000);
    const keys = { gemini: geminiKey, claude: claudeKey, chatgpt: openAIKey, perplexity: perplexityKey };
    const runs = await Promise.all(ENGINE_KEYS.map(async (engine) => {
      const repeated = new Map<string, Promise<EngineResult>>();
      const checkPrompt = async (text: string): Promise<EngineResult> => {
        if (deadline.aborted) return { appeared: false, snippet: "", status: "failed" };
        if (!keys[engine]) return { appeared: false, snippet: "", status: "unavailable" };
        try {
          const evidence = await fetchEngineAnswer(engine, text, keys[engine], deadline);
          return await analyzeAnswer(evidence, filteredVariations, companyName, domain, businessProfile?.whatTheySell ?? "", deadline);
        } catch {
          console.error(`[scan/run] ${engine} check failed`);
          return { appeared: false, snippet: "", status: "failed" };
        }
      };
      const checks = await mapConcurrent(flatPrompts, 4, (fp) => {
        if (repeated.has(fp.text)) { noteReuse("duplicate-prompt"); return repeated.get(fp.text)!; }
        const check = checkPrompt(fp.text);
        repeated.set(fp.text, check);
        return check;
      });
      return [engine, checks] as const;
    }));
    const engineRuns = Object.fromEntries(runs) as Record<typeof ENGINE_KEYS[number], EngineResult[]>;
    const results: PromptResult[] = flatPrompts.map((fp, i) => ({
      prompt: fp.text, category: fp.category,
      gemini: engineRuns.gemini[i], claude: engineRuns.claude[i],
      chatgpt: engineRuns.chatgpt[i], perplexity: engineRuns.perplexity[i],
      sentiment: ENGINE_KEYS.map((key) => engineRuns[key][i]).find((r) => r.appeared && r.sentiment)?.sentiment,
    }));
    const weights = flatPrompts.map((fp) => isHighQualityPrompt(fp.text, filteredVariations) ? 1 : 0.3);
    const scores = calculateScores(results, weights);
    const engineErrors = Object.fromEntries(ENGINE_KEYS.map((key) => [key, !!keys[key] && !scores.engines[key].available])) as Record<typeof ENGINE_KEYS[number], boolean>;
    const brandResults: Record<string, PromptResult[]> = { [domain]: results };
    const uniqueCompetitors = [...new Set((competitors ?? []).map(normalizeDomain))].filter((c) => c !== domain);
    await mapConcurrent(uniqueCompetitors, 2, async (competitor) => {
      const name = competitor.split(".")[0];
      brandResults[competitor] = await mapConcurrent(results, 4, async (row) => {
        const entries = await Promise.all(ENGINE_KEYS.map(async (key) => {
          const source = row[key];
          const check: EngineResult = source.evidence && !deadline.aborted
            ? await analyzeAnswer(source.evidence, [name, competitor], name, competitor, "", deadline)
            : { appeared: false, snippet: "", status: source.evidence ? "unverified" : source.status ?? "failed" };
          return [key, check] as const;
        }));
        return { ...row, ...Object.fromEntries(entries) } as PromptResult;
      });
    });
    const comparisons = compareBrands(brandResults, weights);
    const competitorResults = Object.fromEntries(uniqueCompetitors.map((competitor) => [competitor, {
      domain: competitor, score: comparisons[competitor].overallScore,
      appeared: Object.values(comparisons[competitor].categoryScores).reduce((sum, cat) => sum + cat.appeared, 0),
      total: comparisons[competitor].coverage.successful,
    }]));
    const highQualityCount = weights.filter((w) => w === 1).length;
    const totalPrompts = results.length;
    const highQualityPct = highQualityCount / totalPrompts;
    const promptQualityIndicator = highQualityPct > 0.8 ? "high" : highQualityPct >= 0.5 ? "medium" : "low";
    const factCheckSummary = summarizeFactChecks(results);
    const factCheckIssues = factCheckSummary.issues;

    const contentRecommendations = scores.overallScore !== null ? await generateContentRecommendations(
      domain,
      companyName,
      businessProfile?.whatTheySell ?? "",
      businessProfile?.industry ?? "",
      simplifyTrustSignals(trustSignals),
      results,
      scores.overallScore,
      factCheckIssues
    ) : [];

    let keywordsData: KeywordsData = keywordsFromPrompts(results);
    if (scores.overallScore !== null) {
      try {
        keywordsData = await generateKeywords({ domain, industry: businessProfile?.industry ?? "", companyName,
          whatTheySell: businessProfile?.whatTheySell ?? "", buyerLocation: icp?.buyerLocation ?? "" });
      } catch { console.error("[scan/run] Keyword recommendations unavailable"); }
    }
    const report: ScanData = {
      ...scores, engineErrors, results, competitorResults, factCheckSummary, contentRecommendations,
      domain, businessProfile, trustSignals, businessType,
      icp: icp ?? { primaryBuyer: "", buyerLocation: "", buyerCompanySize: "", buyerPainPoint: "", buyerContext: "" },
      usage: usageSnapshot(),
      methodologyVersion: METHODOLOGY_VERSION,
      createdAt: new Date().toISOString(),
      comparisonScore: comparisons[domain].overallScore,
      comparisonCoverage: comparisons[domain].coverage,
      promptQuality: { highCount: highQualityCount, totalCount: totalPrompts, indicator: promptQualityIndicator },
    };
    report.saveStatus = session ? "failed" : "anonymous";
    if (session) {
      try {
        report.reportId = await saveReport(session, report, keywordsData);
        report.saveStatus = "saved";
      } catch { console.error("[scan/run] Report persistence failed"); }
    }
    return NextResponse.json({ ...report, keywordsData }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(
      "[scan/run] Unexpected top-level error:",
      error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : error
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = measuredRoute("run", handlePost);
