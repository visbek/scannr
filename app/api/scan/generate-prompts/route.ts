import { searchSerper } from "@/lib/serper";
import { cachedResearch, researchKey } from "@/lib/research-cache";
import { providerFetch, measuredRoute, hasProviderFailures, noteResearchFailure } from "@/lib/scan-usage";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { fetchResearchData } from "../research/route";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 0,
  timeout: 45_000,
  fetch: providerFetch("prompt-generation"),
});

// ─── Serper search helper ─────────────────────────────────────────────────────

type SerperOrganic = { title?: string; snippet?: string; link?: string };

async function serperSearch(query: string, num: number = 10): Promise<Record<string, unknown>> {
  try {
    return await searchSerper(query, { gl: "us", num });
  } catch (err) {
    noteResearchFailure();
    console.log(
      `[generate-prompts] Serper error for "${query}":`,
      err instanceof Error ? err.message : err
    );
    return {};
  }
}

// ─── Competitor detection ─────────────────────────────────────────────────────

async function detectCompetitors(
  domain: string,
  companyName: string,
  whatTheySell: string,
  industry: string
): Promise<string[]> {
  try {
    // Excludes the brand's own domain from results, rather than restricting to it —
    // a literal `site:` scope here would return nothing useful for finding competitors.
    const query = `top competitors of ${companyName} ${industry} -site:${domain}`;
    const altQuery = `best alternatives to ${companyName} ${whatTheySell}`;

    const [r1, r2] = await Promise.allSettled([
      serperSearch(query, 5),
      serperSearch(altQuery, 5),
    ]);

    const competitors: string[] = [];
    const seen = new Set([domain]);

    const processResults = (results: SerperOrganic[]) => {
      for (const item of results || []) {
        const link = item.link || "";
        try {
          const url = new URL(link.startsWith("http") ? link : `https://${link}`);
          const d = url.hostname.replace(/^www\./, "");
          if (!seen.has(d) && d.includes(".") && !d.includes("google") &&
              !d.includes("youtube") && !d.includes("linkedin") &&
              !d.includes("facebook") && !d.includes("twitter") &&
              !d.includes("reddit") && !d.includes("amazon") &&
              competitors.length < 3) {
            seen.add(d);
            competitors.push(d);
          }
        } catch {}
      }
    };

    if (r1.status === "fulfilled") processResults((r1.value?.organic ?? []) as SerperOrganic[]);
    if (r2.status === "fulfilled") processResults((r2.value?.organic ?? []) as SerperOrganic[]);

    return competitors.slice(0, 3);
  } catch {
    return [];
  }
}

// ─── Domain normalization ────────────────────────────────────────────────────

function normalizeDomain(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim();
}

// ─── IP rate limiting ─────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true; // allowed
  }
  if (entry.count >= RATE_LIMIT_MAX) return false; // blocked
  entry.count++;
  return true; // allowed
}

function cleanCompanyName(name: string): string {
  return name
    .replace(/\s+by\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*/g, "")
    .replace(/\s*[-–]\s*.+$/, "")
    .trim();
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

// ─── Domain root compound-word splitter ──────────────────────────────────────

function splitDomainRoot(root: string): string {
  const lower = root.toLowerCase();

  // CamelCase split: "goodLives" → "good lives"
  const camelSplit = root.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (camelSplit !== lower) return camelSplit;

  // Known compound patterns — checked before generic split logic
  const knownSplits: Record<string, string> = {
    xflowpay: "xflow pay",
    razorpay: "razor pay",
    cashfree: "cash free",
    paytm: "pay tm",
    phonepe: "phone pe",
    groww: "groww",
    zerodha: "zerodha",
  };
  if (knownSplits[lower]) return knownSplits[lower];

  // Try from end backwards — longer left side preferred (brand first, suffix last)
  for (let i = root.length - 3; i >= 3; i--) {
    const left = lower.slice(0, i);
    const right = lower.slice(i);
    // Don't split on pure digit suffixes — "eco365" stays "eco365", not "eco 365"
    if (/^\d+$/.test(right)) {
      return lower;
    }
    if (left.length >= 3 && right.length >= 3) {
      return `${left} ${right}`;
    }
  }

  return lower;
}

// ─── Brand variation extraction ──────────────────────────────────────────────

// Words that are too generic to be useful standalone brand signals
const GENERIC_PARTS = new Set([
  "energy", "health", "tech", "care", "app",
  "hub", "labs", "works", "media", "group",
  "solutions", "services", "online", "digital",
  "india", "global", "world", "zone", "plus",
  "pro", "live", "now", "easy", "smart",
]);

function getMeaningfulParts(spaceVariant: string): string[] {
  if (!spaceVariant.includes(" ")) return [];
  return spaceVariant.split(" ").filter(p => p.length >= 4 && !GENERIC_PARTS.has(p.toLowerCase()));
}

function extractBrandVariations(html: string, domain: string, httpStatus?: number): string[] {
  const domainRoot = domain
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .split(".")[0];

  // Detect error pages (Cloudflare challenge, 403, etc.) and use domain-only fallback
  const isErrorPage = html.length > 0 && (
    (httpStatus !== undefined && httpStatus >= 400) ||
    /attention required|access denied|error 403|403 forbidden|sorry, you have been blocked|just a moment/i.test(html) ||
    /<title[^>]*>\s*cloudflare\s*<\/title>/i.test(html) ||
    html.length < 500
  );

  if (isErrorPage) {
    console.log("[BRAND] Error page detected, using domain-only fallback for:", domain);
    const spaceVariant = splitDomainRoot(domainRoot);
    const meaningfulParts = getMeaningfulParts(spaceVariant);
    return [...new Set([domainRoot, spaceVariant, ...meaningfulParts])].filter(v => v.length >= 4);
  }

  // Extract signals from HTML
  const signals: string[] = [
    html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i)?.[1],
    html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:site_name"/i)?.[1],
    html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1]
      ?.split(/[|\-–:]/)[0].trim(),
    html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i)?.[1]
      ?.split(/[|\-–:]/)[0].trim(),
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
      ?.split(/[|\-–:]/)[0].trim(),
    html.match(/<meta[^>]*name="application-name"[^>]*content="([^"]+)"/i)?.[1],
    html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim(),
    domainRoot,
  ].filter((s): s is string => !!s && s.length >= 2);

  const raw = new Set<string>();

  signals.forEach((signal) => {
    // As-is
    raw.add(signal);
    // Without spaces
    raw.add(signal.replace(/\s+/g, ""));
    // Hyphens as spaces
    raw.add(signal.replace(/-/g, " "));
    // Domain-style (no spaces, no hyphens)
    raw.add(signal.replace(/[\s-]/g, ""));
  });

  // Always ensure domain root variations are present
  raw.add(domainRoot);
  raw.add(domainRoot.replace(/-/g, ""));
  raw.add(domainRoot.replace(/-/g, " "));
  const domainSpaceVariant = splitDomainRoot(domainRoot);
  raw.add(domainSpaceVariant);
  getMeaningfulParts(domainSpaceVariant).forEach(p => raw.add(p));

  // Boilerplate words plus the short/common false-positive-prone entries from
  // GENERIC_WORDS (app/api/scan/run/route.ts) — relevant here now that the
  // length cutoff is low enough to expose 3-4 char single-word signals.
  const genericWords = new Set([
    "home", "index", "welcome", "untitled", "page", "website", "site",
    "app", "the", "and", "get", "shop",
    "world", "global", "group", "brand", "media", "digital", "agency", "studio",
    "house", "works", "hub", "labs", "cloud", "data", "tech", "core", "edge",
    "link", "base", "local", "social", "direct", "first", "total", "one", "go", "my", "pro",
  ]);

  const rest = [...new Set(raw)].filter(
    (v) => v && v.length >= 3 && !genericWords.has(v.toLowerCase()) && v !== domainRoot
  );
  return [domainRoot, ...rest];
}

// ─── Product name extraction from HTML ───────────────────────────────────────

const NAV_GENERIC = new Set([
  "home", "about", "contact", "blog", "login", "signup", "sign up", "sign in",
  "register", "pricing", "faq", "help", "support", "careers", "jobs", "press",
  "news", "legal", "privacy", "terms", "cookie", "search", "menu", "close",
  "shop", "store", "cart", "checkout", "get started", "learn more", "read more",
  "download", "resources", "docs", "documentation", "api", "partners", "team",
  "company", "solutions", "services", "products", "platform", "enterprise",
  "features", "demo", "try", "book", "schedule", "subscribe", "newsletter",
  "explore", "all", "more", "new", "view", "see", "our", "the", "for", "and",
]);

function extractProductNames(html: string): string[] {
  const names: string[] = [];

  // From nav links — strip inner tags, grab text nodes
  for (const nav of html.match(/<nav[\s\S]*?<\/nav>/gi) ?? []) {
    for (const m of nav.matchAll(/>([^<]{2,40})</g)) {
      const text = m[1].trim();
      if (text.length >= 3 && !NAV_GENERIC.has(text.toLowerCase())) names.push(text);
    }
  }

  // From h2/h3 headings (first 5 of each) — split on common separators
  const headings = [
    ...[...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].slice(0, 5),
    ...[...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].slice(0, 5),
  ];
  for (const m of headings) {
    const text = m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    for (const part of text.split(/[|\-–:,]/)) {
      const clean = part.trim();
      if (clean.length >= 3 && clean.length <= 40 && !NAV_GENERIC.has(clean.toLowerCase()))
        names.push(clean);
    }
  }

  // From Schema.org "name" fields
  for (const m of [...html.matchAll(/"name"\s*:\s*"([^"]{2,40})"/g)].slice(0, 8)) {
    const text = m[1].trim();
    if (!NAV_GENERIC.has(text.toLowerCase())) names.push(text);
  }

  return [...new Set(names)].slice(0, 10);
}

interface WebsiteData {
  url: string;
  title: string;
  metaDescription: string;
  h1s: string[];
  bodyText: string;
  brandVariations: string[];
  productNames: string[];
  blogTopics: string;
}

interface FetchResult {
  html: string;
  status: number;
  ok: boolean;
}

async function tryFetch(url: string): Promise<FetchResult | null> {
  try {
    console.log(`[generate-prompts] Trying: ${url}`);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await response.text();
    console.log(`[generate-prompts] ${url} status ${response.status}, html length: ${html.length}`);
    return { html, status: response.status, ok: response.ok };
  } catch (err) {
    console.log(
      `[generate-prompts] ${url} fetch failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function getWebsiteData(domain: string): Promise<WebsiteData | null> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const urlsToTry = [
    `https://${cleanDomain}`,
    `http://${cleanDomain}`,
    `https://www.${cleanDomain}`,
  ];

  let bestResult: FetchResult | null = null;
  let errorResult: FetchResult | null = null;
  let successUrl = "";

  for (const url of urlsToTry) {
    const result = await tryFetch(url);
    if (!result) continue;
    if (result.ok) {
      bestResult = result;
      successUrl = url;
      break;
    } else if (!errorResult) {
      errorResult = result;
    }
  }

  if (!bestResult) {
    console.log(`[generate-prompts] All URL attempts failed for domain: ${domain}`);
    if (errorResult) {
      // Use error page HTML + status so extractBrandVariations can detect the error and fall back to domain-only
      const brandVariations = extractBrandVariations(errorResult.html, domain, errorResult.status);
      console.log(`[generate-prompts] Error-page brand variations for ${domain}: ${JSON.stringify(brandVariations)}`);
      return { url: "", title: "", metaDescription: "", h1s: [], bodyText: "", brandVariations, productNames: [], blogTopics: "" };
    }
    return null;
  }

  const { html, status } = bestResult;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const metaMatch =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  const metaDescription = metaMatch ? metaMatch[1].trim() : "";

  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  const h1s = h1Matches
    .map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
    .filter((h) => h.length > 0)
    .slice(0, 5);

  const rawBodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);

  // Fetch /about and /about-us for richer context
  let aboutText = "";
  for (const aboutPath of ["/about", "/about-us"]) {
    try {
      const aboutResult = await tryFetch(`${successUrl}${aboutPath}`);
      if (aboutResult?.ok && aboutResult.html.length > 500) {
        const extracted = aboutResult.html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 800);
        if (extracted && !rawBodyText.includes(extracted.slice(0, 50))) {
          aboutText = extracted;
          console.log(`[generate-prompts] Appended about page from ${successUrl}${aboutPath}`);
          break;
        }
      }
    } catch {
      // continue with next path
    }
  }

  const bodyText = aboutText ? `${rawBodyText} | About: ${aboutText}` : rawBodyText;

  // Fetch blog/resources page for article topics
  let blogTopics = "";
  for (const blogPath of ["/blog", "/resources", "/resource-center"]) {
    try {
      const blogResult = await tryFetch(`${successUrl}${blogPath}`);
      if (blogResult?.ok && blogResult.html.length > 500) {
        const articleTitles: string[] = [];
        for (const m of [...blogResult.html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].slice(0, 8)) {
          const text = m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          if (text.length > 20 && text.length < 150 && !articleTitles.includes(text)) articleTitles.push(text);
        }
        if (articleTitles.length < 5) {
          for (const m of [...blogResult.html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].slice(0, 8)) {
            const text = m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            if (text.length > 20 && text.length < 150 && !articleTitles.includes(text)) articleTitles.push(text);
          }
        }
        if (articleTitles.length > 0) {
          blogTopics = articleTitles.slice(0, 5).join(" | ");
          console.log(`[generate-prompts] Blog topics from ${successUrl}${blogPath}: "${blogTopics.slice(0, 150)}"`);
          break;
        }
      }
    } catch {
      // continue with next path
    }
  }

  const brandVariations = extractBrandVariations(html, domain, status);
  const productNames = extractProductNames(html);

  console.log(`[generate-prompts] Extracted from ${successUrl}:`);
  console.log(`  title: "${title}"`);
  console.log(`  metaDescription: "${metaDescription.slice(0, 150)}"`);
  console.log(`  h1s: ${JSON.stringify(h1s)}`);
  console.log(`  brandVariations: ${JSON.stringify(brandVariations)}`);
  console.log(`  productNames: ${JSON.stringify(productNames)}`);
  console.log(`  blogTopics: "${blogTopics.slice(0, 100)}"`);
  console.log(`  bodyText (first 200): "${bodyText.slice(0, 200)}"`);

  return { url: successUrl, title, metaDescription, h1s, bodyText, brandVariations, productNames, blogTopics };
}

// ─── Generic phrase detection (never allow these in any prompt) ──────────────

const GENERIC_PHRASES = [
  "choosing a vendor in this category",
  "evaluate options before making a purchase",
  "common mistakes buyers make",
  "how much should i expect to pay",
  "questions to ask before hiring",
  "how do i know if a provider is trustworthy",
];

function isGenericPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return GENERIC_PHRASES.some((phrase) => lower.includes(phrase));
}

const BANNED_JARGON = [
  "FEMA-compliant",
  "global paymaster",
  "nostro account",
];

function containsJargon(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return BANNED_JARGON.some((phrase) => lower.includes(phrase.toLowerCase()));
}

// ─── Post-generation brand name + generic phrase validation ──────────────────

async function validateAndFixPrompts(
  parsedPrompts: Record<string, string[]>,
  companyName: string,
  domain: string,
  brandVariations: string[],
  whatTheySell: string,
  industry: string
): Promise<Record<string, string[]>> {
  const categories = ["informational", "discovery", "commercial", "transactional"] as const;

  const termsToBan = [
    companyName.toLowerCase(),
    domain.split(".")[0].toLowerCase(),
    ...brandVariations.map((v) => v.toLowerCase()),
  ].filter((t) => t.length >= 5);

  function containsBrandName(prompt: string): boolean {
    if (termsToBan.length === 0) return false;
    const lower = prompt.toLowerCase();
    return termsToBan.some((term) => lower.includes(term));
  }

  function isBadPrompt(prompt: string): boolean {
    return containsBrandName(prompt) || isGenericPrompt(prompt) || containsJargon(prompt);
  }

  async function tryRegenerate(
    category: string,
    badPrompt: string,
    reason: string
  ): Promise<string | null> {
    try {
      const msg = await callClaudeWithRetry({
        model: "claude-sonnet-4-5",
        max_tokens: 200,
        temperature: 0,
        messages: [{
          role: "user",
          content: `Rewrite this ${category} buyer search prompt for a company that sells: ${whatTheySell} (${industry}).

Bad prompt (${reason}): "${badPrompt}"

Requirements:
- NEVER include any company name, brand name, or domain
- NEVER use phrases like "choosing a vendor in this category", "evaluate options before making a purchase", "common mistakes buyers make", "how much should I expect to pay", "questions to ask before hiring", "how do I know if a provider is trustworthy"
- NEVER use technical jargon: "inward remittance", "outward remittance", "FEMA-compliant", "PA-CB compliant", "payment aggregator infrastructure", "cross-border collection infrastructure", "nostro account", "bulk collections", "global paymaster"
- Must reference a specific pain point, use case, or buyer situation in this exact category
- Write exactly how a real person types into ChatGPT — plain language, conversational, specific, no year numbers, no jargon

Return ONLY the rewritten prompt, no quotes, no explanation.`,
        }],
      });
      const c = msg.content[0];
      if (c.type === "text") return c.text.trim().replace(/^["']|["']$/g, "");
    } catch {
      // fall through
    }
    return null;
  }

  let replacedCount = 0;
  let skippedCount = 0;

  for (const cat of categories) {
    const catPrompts = parsedPrompts[cat] ?? [];
    const cleanedPrompts: string[] = [];

    for (let i = 0; i < catPrompts.length; i++) {
      let current = catPrompts[i];

      if (isBadPrompt(current)) {
        const reason = containsBrandName(current) ? "contains brand name" : containsJargon(current) ? "contains technical jargon — rewrite in plain language that a real person would type into Google or ChatGPT. No jargon." : "too generic";
        console.log(`[generate-prompts] [${cat}][${i}] ${reason}: "${current.slice(0, 80)}"`);

        let fixed = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          const regenerated = await tryRegenerate(cat, current, reason);
          if (regenerated && !isBadPrompt(regenerated)) {
            current = regenerated;
            fixed = true;
            replacedCount++;
            console.log(`[generate-prompts] [${cat}][${i}] regenerated (attempt ${attempt + 1}): "${current}"`);
            break;
          } else if (regenerated) {
            current = regenerated;
          }
        }

        if (!fixed) {
          skippedCount++;
          console.log(`[generate-prompts] [${cat}][${i}] still bad after 2 attempts — skipping`);
          continue;
        }
      }

      cleanedPrompts.push(current);
    }

    (parsedPrompts[cat] as string[]) = cleanedPrompts;
  }

  if (replacedCount === 0 && skippedCount === 0) {
    console.log("[generate-prompts] Validation OK — no brand names or generic prompts");
  } else {
    console.log(`[generate-prompts] Validation: regenerated ${replacedCount}, skipped ${skippedCount} prompt(s)`);
  }

  return parsedPrompts;
}

// ─── Claude API call with retry on 429 ───────────────────────────────────────

async function callClaudeWithRetry(
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  maxRetries = 2
): Promise<Anthropic.Message> {
  let lastError: Error = new Error("Max retries exceeded");
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = 2000 * attempt;
      console.warn(`[generate-prompts] Claude rate limited — retrying (attempt ${attempt + 1}/${maxRetries}) after ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await client.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status === 429) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ─── Core generation logic (extracted for dedup lock) ────────────────────────

async function generatePromptsForDomain(domain: string): Promise<unknown> {
  console.log(`[generate-prompts] MISS for: ${domain}`);

  const websiteData = await getWebsiteData(domain);

  // Derive search terms from available website data (before Claude runs)
  const hasContent = !!(websiteData?.bodyText);
  // Pick the longest title segment as the industry hint — works regardless of whether
  // the title is formatted "Brand | Description" or "Description | Brand" (brand names
  // are typically much shorter than descriptive taglines, so length picks correctly
  // either way, unlike always taking the part after the first separator).
  const industryHint = hasContent
    ? (() => {
        const titleParts = websiteData!.title.split(/[|\-–]/).map((p) => p.trim()).filter(Boolean);
        const longestTitlePart = titleParts.length > 1
          ? titleParts.reduce((longest, part) => (part.length > longest.length ? part : longest))
          : "";
        return longestTitlePart || websiteData!.metaDescription.slice(0, 60) || domain;
      })()
    : domain;
  const companyHint = websiteData?.brandVariations[0] ?? domain.split(".")[0];
  const productNames = websiteData?.productNames ?? [];

  // Fetch real internet data in parallel with no blocking on failure
  const websiteText = [
    websiteData?.bodyText ?? '',
    websiteData?.title ?? '',
    websiteData?.metaDescription ?? '',
  ].filter(Boolean).join(' ').slice(0, 2000);
  const researchData = await fetchResearchData(industryHint, companyHint, domain, undefined, websiteText);

  // Fetch brand context from Serper — top snippets (press, G2, Crunchbase) often describe the company better than its homepage
  let brandContext = "";
  try {
    const brandData = await serperSearch(`"${companyHint}" what is ${companyHint}`);
    const snippets = ((brandData.organic ?? []) as SerperOrganic[])
      .slice(0, 3)
      .map((r) => r.snippet ?? "")
      .filter(Boolean);
    if (snippets.length > 0) {
      brandContext = snippets.join(" | ");
      console.log(`[generate-prompts] Brand context: "${brandContext.slice(0, 150)}"`);
    }
  } catch {
    // continue without brand context
  }

  const hasResearch =
    researchData.redditTitles.length > 0 ||
    researchData.peopleAlsoAsk.length > 0 ||
    researchData.youtubeTitles.length > 0 ||
    researchData.quoraTitles.length > 0;

  const customerLang = researchData.trustSignals.customerLanguage;
  const researchBlock = hasResearch
    ? `
REAL DATA from the internet about this industry:

Reddit discussions (real buyer questions):
${researchData.redditTitles.slice(0, 5).join("\n")}

Google People Also Ask (real searches):
${researchData.peopleAlsoAsk.slice(0, 5).join("\n")}

YouTube searches (real queries):
${researchData.youtubeTitles.slice(0, 5).join("\n")}

Quora questions (real buyer questions):
${researchData.quoraTitles.slice(0, 5).join("\n")}
${customerLang.length > 0 ? `
Customer language (exact phrases from reviews and discussions — use these verbatim where natural):
${customerLang.slice(0, 10).join("\n")}
` : ""}
Use the REAL DATA above as inspiration for how real buyers actually talk and search. Make the prompts sound exactly like real people — not marketing language.
`
    : "";

  let claudePrompt: string;
  if (websiteData?.bodyText) {
    claudePrompt = `You are generating search prompts for an AI visibility scanner.
${researchBlock}
Analyze this website and return a detailed JSON object. Read every field carefully — use the actual website content, not guesses.

${websiteData.blogTopics ? `Blog topics (FIRST — extract natural search language from these titles. A blog titled "How to collect international payments" → query is "how to collect international payments" NOT "international payment collection solution"): ${websiteData.blogTopics}` : ""}
Website title: ${websiteData.title || "(not found)"}
Meta description: ${websiteData.metaDescription || "(not found)"}
H1 tags: ${websiteData.h1s.length > 0 ? websiteData.h1s.join(" | ") : "(not found)"}
Product/service names: ${productNames.length > 0 ? productNames.join(", ") : "(none detected)"}
Content: ${websiteData.bodyText}
Domain: ${domain}
${brandContext ? `\nAdditional brand context from web:\n${brandContext}` : ""}

Return ONLY this JSON structure, no markdown, no explanation:

{
  "businessProfile": {
    "companyName": "exact company name from the website",
    "whatTheySell": "specific products/services in 1 sentence",
    "industry": "specific industry (not generic)",
    "geography": "where they operate or sell (city, country, or global)",
    "businessModel": "B2B or B2C or both",
    "scope": "LOCAL (serves a specific city or region) or NATIONAL or GLOBAL",
    "type": "SERVICE (hiring/booking a person or team) or PRODUCT (physical goods) or SAAS (software/app/platform)"
  },
  "icp": {
    "primaryBuyer": "job title or type of person who buys this",
    "buyerLocation": "city/country/region where buyers are",
    "buyerCompanySize": "individual or SMB or enterprise",
    "buyerPainPoint": "the specific problem buyers are solving",
    "buyerContext": "what situation or trigger makes them search for this"
  },
  "prompts": {
    "informational": [
      "prompt 1",
      "prompt 2",
      "prompt 3",
      "prompt 4",
      "prompt 5",
      "prompt 6"
    ],
    "discovery": [
      "prompt 1",
      "prompt 2",
      "prompt 3",
      "prompt 4",
      "prompt 5",
      "prompt 6"
    ],
    "commercial": [
      "prompt 1",
      "prompt 2",
      "prompt 3",
      "prompt 4",
      "prompt 5",
      "prompt 6"
    ],
    "transactional": [
      "prompt 1",
      "prompt 2",
      "prompt 3",
      "prompt 4",
      "prompt 5",
      "prompt 6"
    ]
  }
}

Rules for prompts:
- informational: 6 prompts where a real person with a problem is searching for information. Write in plain language — how a non-expert would actually type this into Google. GOOD examples: "how to receive money from US clients in India", "why is PayPal so expensive for Indian businesses receiving international payments", "best way to get paid internationally as Indian freelancer". BAD (too technical): "inward remittance solutions for Indian exporters", "cross-border collection infrastructure for SMEs".
- discovery: 6 prompts for real searches when looking for vendors. Mix plain and specific language. GOOD examples: "Wise alternatives for Indian freelancers", "best apps to receive international payments India", "Stripe alternative for Indian SaaS startup". BAD: "PA-CB compliant payment aggregator India".
- commercial: 6 prompts for comparison searches buyers do when evaluating options. GOOD examples: "Payoneer vs Skydo fees comparison", "best cross border payment platform India", "cheapest way to receive USD payments as Indian freelancer". BAD: "cross border payment gateway API India bulk enterprise".
- transactional: 6 prompts for action-oriented searches from buyers ready to sign up or buy. GOOD examples: "sign up for international payment account India", "open virtual USD account for Indian business", "how to set up an account to receive foreign payments". BAD: "integrate FEMA-compliant API payment solution".

BUYER MIX RULE — for each category, mix buyer types:
- 4 plain language prompts written for individuals or SMBs (freelancer, founder, small team, finance manager)
- 2 technical prompts written for developers or enterprise buyers (developer, CFO, ops team, enterprise buyer)
NEVER write all 6 prompts for the same buyer type.

REAL SEARCH LANGUAGE RULE — if blog topics are provided above, extract the natural language from those titles and use it verbatim in prompts. A blog titled "How to collect international payments" → the search query is "how to collect international payments India" NOT "international payment collection solution". Use real words from real content.

Business type rules — use the scope and type fields you detected above:
- If scope=LOCAL: always include the specific city or region in prompts (e.g. "best plumber in Austin TX", "yoga studio near me London")
- If scope=NATIONAL or GLOBAL: include country context where it strengthens the prompt, but do not force it
- If type=SERVICE: prompts should reflect finding/hiring/booking language (e.g. "hire", "book", "near me", "best [profession] in [city]")
- If type=PRODUCT: prompts should reflect shopping/buying/comparing products (e.g. "buy", "where to get", "best brand for", "review")
- If type=SAAS: prompts should reflect software evaluation language (e.g. "best tool for", "alternatives to", "pricing", "review", "vs")
- If businessModel=B2B: use procurement/vendor research language ("vendor", "platform for teams", "enterprise solution", "agency")
- If businessModel=B2C: use consumer decision language ("affordable", "easy to use", "for beginners", "best value")

CRITICAL RULES — never violate these:
- RULE 1: NEVER include the company name, brand name, or domain in any prompt. The buyer does not know which brand to choose yet. Bad: "Bumble Crunch review — is it worth it?". Good: "Is AI-native analytics worth it for small product teams?"
- RULE 2: Write every prompt as if the buyer is searching for a solution, not a specific brand.
- RULE 3: Informational — buyer learning about the problem space. No brand names, no vendor names. Pure educational intent.
- RULE 4: Discovery — buyer looking for vendors. Use category language: "best [category] tool", "top [service] providers in [city]", "which companies offer [solution]".
- RULE 5: Commercial — buyer comparing options. Use: "alternatives to [generic category]", "[tool type] vs [tool type]", "compare [service type] providers", "[solution] pricing".
- RULE 6: Transactional — buyer ready to purchase. Use: "book a consultation with a [specialist type]", "sign up for [category] software", "hire a [profession] in [city]", "best [service] near me".
- Write prompts exactly how a real person types into ChatGPT or Gemini — conversational, plain language, specific, no jargon
- Include the buyer role or context when it makes the prompt more realistic
- Make every prompt specific to THIS business category, not generic filler
- IMPORTANT: Do NOT include any year (2024, 2025, 2026) in the prompts. Write timeless prompts. Instead of "best tool 2024" write "best tool right now" or just "best tool"
- If specific product/service names are listed above (model names, plan tiers, product lines), you may reference them in commercial and transactional prompts to make questions more realistic (e.g. "best alternatives to [product name]", "how does [product] compare to other options"). NEVER include the company name or brand name.
- Each array must have exactly 6 prompts
- RULE: Where the People Also Ask questions provided above match this business category, use them as the basis for Informational and Discovery prompts — these are real questions buyers search for. Rephrase them slightly to remove any brand names but keep the exact intent and phrasing.
- BANNED PHRASES: Never use any of these generic phrases in any prompt: "choosing a vendor in this category", "evaluate options before making a purchase decision", "common mistakes buyers make", "how much should I expect to pay for this type of service", "questions to ask before hiring someone", "how do I know if a provider is trustworthy". Every prompt must be specific enough that only a buyer in this exact category would search for it.
- BANNED JARGON: Never use technical or regulatory jargon that a non-specialist would not type into Google: "inward remittance", "outward remittance", "FEMA-compliant", "PA-CB compliant", "payment aggregator infrastructure", "cross-border collection infrastructure", "nostro account", "bulk collections", "global paymaster". Write in plain language a real person would search.`;
  } else {
    console.log(`[generate-prompts] Website fetch failed — falling back to domain-only prompt`);
    claudePrompt = `You are generating search prompts for an AI visibility scanner.
${researchBlock}
Given the domain "${domain}", infer what this company does and return this JSON structure.

Return ONLY this JSON, no markdown, no explanation:

{
  "businessProfile": {
    "companyName": "likely company name from the domain",
    "whatTheySell": "inferred products/services",
    "industry": "inferred industry",
    "geography": "unknown",
    "businessModel": "B2B or B2C"
  },
  "icp": {
    "primaryBuyer": "likely buyer persona",
    "buyerLocation": "unknown",
    "buyerCompanySize": "unknown",
    "buyerPainPoint": "likely pain point",
    "buyerContext": "likely buying context"
  },
  "prompts": {
    "informational": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5", "prompt 6"],
    "discovery": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5", "prompt 6"],
    "commercial": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5", "prompt 6"],
    "transactional": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5", "prompt 6"]
  }
}

CRITICAL RULES: NEVER include the company name, brand name, or domain in any prompt. The buyer is searching for a solution, not a specific brand. Informational: buyer learning about the problem space. Discovery: buyer looking for vendors using category language. Commercial: buyer comparing options. Transactional: buyer ready to purchase.
Write all 24 prompts as long, conversational questions a real person would type into ChatGPT. Do NOT include any year (2024, 2025, 2026) in prompts.`;
  }

  console.log("[generate-prompts] Calling Claude for ICP analysis + 24 prompts...");

  const message = await callClaudeWithRetry({
    model: "claude-sonnet-4-5",
    max_tokens: 3000,
    temperature: 0,
    messages: [{ role: "user", content: claudePrompt }],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error(`Unexpected response type from Claude: ${content.type}`);
  }

  const rawText = content.text;
  console.log("[generate-prompts] Claude raw response (first 400 chars):", rawText.slice(0, 400));

  const cleaned = stripCodeFences(rawText);
  const parsed = JSON.parse(cleaned);

  // Clean companyName: strip "by [Person Name]" and "- tagline" patterns
  if (parsed?.businessProfile?.companyName) {
    const original = parsed.businessProfile.companyName;
    parsed.businessProfile.companyName = cleanCompanyName(original);
    if (parsed.businessProfile.companyName !== original) {
      console.log(`[generate-prompts] Cleaned companyName: "${original}" → "${parsed.businessProfile.companyName}"`);
    }
  }

  // Base brand variations (company/domain signals only) — used for prompt banning
  const baseBrandVariations = websiteData?.brandVariations?.length
    ? websiteData.brandVariations
    : extractBrandVariations("", domain);

  // Product name variants for detection (not banned from prompts)
  const productVariants = productNames.flatMap(p => [p, p.replace(/\s+/g, "")]);

  // Final brandVariations: company signals + product names → for detection in run/route.ts
  parsed.brandVariations = [...new Set([...baseBrandVariations, ...productVariants])].filter(v => v.length >= 3);

  // Attach trust signals and business type gathered during research phase
  parsed.trustSignals = researchData.trustSignals;
  parsed.businessType = researchData.businessType;

  console.log(`[generate-prompts] brandVariations: ${JSON.stringify(parsed.brandVariations)}`);
  console.log(`[generate-prompts] productNames: ${JSON.stringify(productNames)}`);
  console.log("[generate-prompts] Parsed OK");
  console.log("  businessProfile:", JSON.stringify(parsed.businessProfile));
  console.log("  icp:", JSON.stringify(parsed.icp));
  console.log("  informational prompts:", parsed.prompts?.informational?.length);
  console.log("  discovery prompts:", parsed.prompts?.discovery?.length);
  console.log("  commercial prompts:", parsed.prompts?.commercial?.length);
  console.log("  transactional prompts:", parsed.prompts?.transactional?.length);

  // Validate and fix prompts — ban brand names + generic phrases, regenerate via Claude
  if (parsed.prompts && typeof parsed.prompts === "object") {
    parsed.prompts = await validateAndFixPrompts(
      parsed.prompts as Record<string, string[]>,
      parsed.businessProfile?.companyName ?? "",
      domain,
      baseBrandVariations,
      parsed.businessProfile?.whatTheySell ?? "",
      parsed.businessProfile?.industry ?? ""
    );
  }

  // Google result counts do not measure buyer demand. Keep the contextual and
  // unbranded-question checks above without a second paid search for each prompt.

  // Detect 2-3 competitor domains for share-of-voice comparison in run/route.ts
  const competitors = await detectCompetitors(
    domain,
    parsed.businessProfile?.companyName ?? companyHint,
    parsed.businessProfile?.whatTheySell ?? "",
    parsed.businessProfile?.industry ?? industryHint
  );
  parsed.competitors = competitors;
  console.log(`[generate-prompts] competitors: ${JSON.stringify(competitors)}`);

  return parsed;
}

// ─── Route handler ────────────────────────────────────────────────────────────

async function handlePost(request: NextRequest) {
  console.log("[generate-prompts] Route hit");

  // ── IP rate limit check ──────────────────────────────────────────────────
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    console.log(`[generate-prompts] Rate limit exceeded for IP: ${ip}`);
    return NextResponse.json(
      {
        error: "rate_limit",
        message:
          "You have used your 3 free scans for today. Upgrade to scan unlimited domains.",
      },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { domain } = body;

    console.log(`[generate-prompts] Domain received: "${domain}"`);

    if (!domain || typeof domain !== "string") {
      return NextResponse.json({ error: "domain is required" }, { status: 400 });
    }

    const normalizedDomain = normalizeDomain(domain);
    // Start new fetch and register it as pending
    const fetchPromise = cachedResearch("company-prompts-v20", [normalizedDomain,
      researchKey([process.env.ANTHROPIC_API_KEY, process.env.SERPER_API_KEY])], 86400, async () => {
      const result = await generatePromptsForDomain(normalizedDomain);
      if (hasProviderFailures()) throw new PartialResearch(result);
      return result;
    }).catch(error => {
      if (error instanceof PartialResearch) return error.result;
      throw error;
    });


    return NextResponse.json(await fetchPromise);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error("[generate-prompts] JSON.parse failed:", error.message);
      return NextResponse.json(
        { error: "Failed to parse Claude response as JSON" },
        { status: 500 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`[generate-prompts] Anthropic API error — status=${error.status} message=${error.message}`);
      return NextResponse.json(
        { error: `Anthropic API error: ${error.message}` },
        { status: error.status ?? 500 }
      );
    }
    console.error("[generate-prompts] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

class PartialResearch extends Error { constructor(public result: unknown) { super("Partial research was not cached"); } }
export const POST = measuredRoute("generate-prompts", handlePost);
