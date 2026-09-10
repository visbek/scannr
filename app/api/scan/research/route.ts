import { searchSerper } from "@/lib/serper";
import { measuredRoute, noteResearchFailure } from "@/lib/scan-usage";
import { NextRequest, NextResponse } from "next/server";

// ─── IP rate limiting ─────────────────────────────────────────────────────────

interface RateLimitEntry { count: number; resetTime: number }
const researchRateLimitMap = new Map<string, RateLimitEntry>();
const RESEARCH_RATE_LIMIT_MAX = 10;
const RESEARCH_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function checkResearchRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = researchRateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    researchRateLimitMap.set(ip, { count: 1, resetTime: now + RESEARCH_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RESEARCH_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrustSignals {
  trustpilot: { exists: boolean; rating?: number; count?: number; url?: string };
  g2: { exists: boolean; rating?: number; count?: number };
  capterra: { exists: boolean; rating?: number };
  indiamartListing?: { exists: boolean; url?: string };
  marketplaceListing?: { exists: boolean; url?: string };
  faqPage: { exists: boolean; url?: string; questions?: string[] };
  aboutPage: { exists: boolean; hasExperience: boolean; hasCustomerCount: boolean; hasCertifications: boolean; hasAwards: boolean };
  pressmentions: { exists: boolean; sources?: string[] };
  redditMentions: { exists: boolean; sentiment?: string; count?: number };
  medium: { exists: boolean };
  substack: { exists: boolean };
  youtube: { exists: boolean; videoCount?: number; channelUrl?: string };
  linkedinPage?: { exists: boolean; url?: string };
  competitors: string[];
  customerLanguage: string[];
}

export interface ResearchData {
  peopleAlsoAsk: string[];
  redditTitles: string[];
  youtubeTitles: string[];
  quoraTitles: string[];
  trustSignals: TrustSignals;
  businessType: 'software' | 'physical' | 'service';
}

// ─── Business type detection ──────────────────────────────────────────────────

const PHYSICAL_PRODUCT_SIGNALS = [
  'manufacturer', 'supplier', 'product', 'hardware',
  'equipment', 'fixture', 'bag', 'bags', 'packaging',
  'material', 'device', 'machine', 'goods',
  'wholesale', 'retail', 'shop', 'store', 'buy',
  'compostable', 'biodegradable', 'water saver',
  'physical', 'factory', 'production',
  'aerator', 'sprayer', 'tray', 'plate',
  'green product', 'eco product', 'washroom',
  'sustainability', 'environment',
];

const SOFTWARE_SIGNALS = [
  'software', 'saas', 'platform', 'app', 'tool',
  'dashboard', 'api', 'integration', 'subscription',
  'cloud', 'digital', 'analytics', 'automation',
];

export function detectBusinessType(
  whatTheySell: string,
  websiteContent: string
): 'software' | 'physical' | 'service' {
  const text = (whatTheySell + ' ' + websiteContent).toLowerCase();
  const physicalScore = PHYSICAL_PRODUCT_SIGNALS.filter(s => text.includes(s)).length;
  const softwareScore = SOFTWARE_SIGNALS.filter(s => text.includes(s)).length;
  if (physicalScore > softwareScore) return 'physical';
  if (softwareScore > 0) return 'software';
  return 'service';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Shared Serper helper ─────────────────────────────────────────────────────

type SerperOrganic = { title?: string; snippet?: string; link?: string };
type SerperVideo = { title?: string; snippet?: string; link?: string };

async function serperSearch(
  query: string,
  type: "search" | "videos" = "search"
): Promise<Record<string, unknown>> {
  try {
    return await searchSerper(query, { type, gl: "us", num: 10 });
  } catch (err) {
    noteResearchFailure();
    console.log(
      `[research] Serper error for "${query}":`,
      err instanceof Error ? err.message : err
    );
    return {};
  }
}

// ─── Rating/count extractors ──────────────────────────────────────────────────

function extractRating(text: string): number | undefined {
  const m =
    text.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*5|stars?|out of 5)/i) ||
    text.match(/TrustScore\s+(\d+(?:\.\d+)?)/i) ||
    text.match(/rated?\s+(\d+(?:\.\d+)?)/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*\|\s*[\d,]+\s*reviews?/i);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  return v >= 0 && v <= 5 ? v : undefined;
}

function extractReviewCount(text: string): number | undefined {
  const m =
    text.match(/([\d,]+)\s*reviews?/i) ||
    text.match(/([\d,]+)\s*ratings?/i);
  if (!m) return undefined;
  const v = parseInt(m[1].replace(/,/g, ""), 10);
  return isNaN(v) ? undefined : v;
}

// ─── Original fetchers (kept for generate-prompts researchBlock) ──────────────

async function fetchPeopleAlsoAsk(industry: string): Promise<string[]> {
  const data = await serperSearch(`${industry} software`);
  const questions = ((data.peopleAlsoAsk ?? []) as { question?: string }[]).map(
    (item) => item.question ?? ""
  );
  console.log(`[research] PAA: ${questions.length} questions`);
  return questions.filter(Boolean);
}

async function fetchQuoraTitles(industry: string, companyName: string): Promise<string[]> {
  const data = await serperSearch(`site:quora.com ${industry} ${companyName}`);
  const titles = ((data.organic ?? []) as SerperOrganic[]).map((item) =>
    (item.title ?? "")
      .replace(/\s*-\s*Quora$/i, "")
      .replace(/^Quora:\s*/i, "")
      .trim()
  );
  console.log(`[research] Quora: ${titles.length} titles`);
  return titles.filter(Boolean);
}

async function fetchYoutubeTitles(industry: string): Promise<string[]> {
  const data = await serperSearch(`${industry} review comparison`, "videos");
  const titles = ((data.videos ?? []) as SerperVideo[]).map((item) => item.title ?? "");
  console.log(`[research] YouTube industry: ${titles.length} titles`);
  return titles.filter(Boolean);
}

async function fetchRedditTitles(industry: string): Promise<string[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(industry)}&sort=relevance&limit=10`;
    const res = await fetch(url, {
      headers: { "User-Agent": "sparrwo/1.0 research tool" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.log(`[research] Reddit fetch failed: HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as { data?: { children?: { data?: { title?: string } }[] } };
    const titles = (json?.data?.children ?? []).map(
      (child) => child.data?.title ?? ""
    );
    console.log(`[research] Reddit: ${titles.length} titles`);
    return titles.filter(Boolean);
  } catch (err) {
    console.log("[research] Reddit error:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── New trust signal fetchers ────────────────────────────────────────────────

async function fetchTrustpilot(companyName: string, domain: string): Promise<TrustSignals["trustpilot"]> {
  const domainRoot = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];

  // Serper queries first
  const queries = [
    `site:trustpilot.com "${domainRoot}"`,
    `site:trustpilot.com "${companyName}"`,
    `site:trustpilot.com ${companyName} reviews`,
  ];
  const companySlugTp = companyName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  const domainSlugTp = domainRoot.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const query of queries) {
    const data = await serperSearch(query);
    const result = ((data.organic ?? []) as SerperOrganic[])[0];
    if (result?.link?.includes("trustpilot.com")) {
      const link = result.link.toLowerCase();
      const isOwnProfile =
        link.includes(domainSlugTp) ||
        link.includes(companySlugTp) ||
        (result.snippet ?? '').toLowerCase().includes(companySlugTp);
      if (!isOwnProfile) continue;
      const combined = `${result.title ?? ""} ${result.snippet ?? ""}`;
      return {
        exists: true,
        url: result.link,
        rating: extractRating(combined),
        count: extractReviewCount(combined),
      };
    }
  }

  // Direct HEAD fetch — catches unclaimed/0-review profiles not indexed by Google
  for (const slug of [domain, domainRoot]) {
    try {
      const url = `https://www.trustpilot.com/review/${slug}`;
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      if (res.ok) return { exists: true, url };
    } catch {}
  }

  return { exists: false };
}

async function fetchG2(companyName: string, domain: string): Promise<TrustSignals["g2"]> {
  const domainRoot = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];

  // Serper queries first
  const queries = [
    `site:g2.com "${companyName}"`,
    `site:g2.com "${domainRoot}"`,
  ];
  const companySlugG2 = companyName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  const domainSlugG2 = domainRoot.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const query of queries) {
    const data = await serperSearch(query);
    const result = ((data.organic ?? []) as SerperOrganic[])[0];
    if (result?.link?.includes("g2.com")) {
      const link = result.link.toLowerCase();
      const isOwnProfile =
        link.includes(domainSlugG2) ||
        link.includes(companySlugG2) ||
        (result.snippet ?? '').toLowerCase().includes(companySlugG2);
      if (!isOwnProfile) continue;
      const combined = `${result.title ?? ""} ${result.snippet ?? ""}`;
      return { exists: true, rating: extractRating(combined), count: extractReviewCount(combined) };
    }
  }

  // Direct HEAD fetch for common G2 URL patterns
  const slug = domainRoot.split(".")[0];
  for (const url of [
    `https://www.g2.com/products/${slug}/reviews`,
    `https://www.g2.com/sellers/${slug}`,
  ]) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      if (res.ok) return { exists: true };
    } catch {}
  }

  return { exists: false };
}

async function fetchCapterra(companyName: string, domain: string): Promise<TrustSignals["capterra"]> {
  const domainRoot = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
  const queries = [
    `site:capterra.com "${companyName}"`,
    `site:capterra.com "${domainRoot}"`,
    `site:capterra.com "${domainRoot}.com"`,
  ];
  const companySlugCa = companyName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  const domainSlugCa = domainRoot.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const query of queries) {
    const data = await serperSearch(query);
    const result = ((data.organic ?? []) as SerperOrganic[])[0];
    if (result?.link?.includes("capterra.com")) {
      const link = result.link.toLowerCase();
      const isOwnProfile =
        link.includes(domainSlugCa) ||
        link.includes(companySlugCa) ||
        (result.snippet ?? '').toLowerCase().includes(companySlugCa);
      if (!isOwnProfile) continue;
      const combined = `${result.title ?? ""} ${result.snippet ?? ""}`;
      return { exists: true, rating: extractRating(combined) };
    }
  }
  return { exists: false };
}

async function fetchFaqPage(domain: string): Promise<TrustSignals["faqPage"]> {
  // Signal 1: direct HEAD fetch — catches SPAs and non-indexed pages
  for (const path of ["/faq", "/faqs"]) {
    try {
      const res = await fetch(`https://${domain}${path}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok || res.status === 405) {
        return { exists: true, url: `https://${domain}${path}` };
      }
    } catch {}
  }

  // Signal 2: Serper site search with broader path matching
  const data = await serperSearch(`site:${domain} faq`);
  const organic = (data?.organic ?? []) as SerperOrganic[];
  const match = organic.find((r) =>
    /\/(faq|faqs|frequently-asked|help)/i.test(r.link ?? "")
  );
  if (match) return { exists: true, url: match.link };

  return { exists: false };
}

async function fetchAboutPage(domain: string): Promise<TrustSignals["aboutPage"]> {
  const data = await serperSearch(`site:${domain} about`);
  const organic = (data.organic ?? []) as SerperOrganic[];
  if (organic.length === 0) {
    return { exists: false, hasExperience: false, hasCustomerCount: false, hasCertifications: false, hasAwards: false };
  }
  const text = organic.map((r) => r.snippet ?? "").join(" ");
  return {
    exists: true,
    hasExperience: /(\d+\s+years?|founded\s+in|since\s+\d{4}|est\.\s*\d{4})/i.test(text),
    hasCustomerCount: /(customers?|clients?|users?|projects? completed|happy clients?)/i.test(text),
    hasCertifications: /(certif|iso\s*\d+|accredit|licensed|compliance)/i.test(text),
    hasAwards: /(award|winner|recogni|featured in|best\s+\w+\s+\d{4})/i.test(text),
  };
}

const SOCIAL_MEDIA_DOMAINS = new Set([
  "linkedin.com", "instagram.com", "facebook.com",
  "twitter.com", "x.com", "tiktok.com", "pinterest.com",
  "youtube.com", "reddit.com", "threads.net",
  "snapchat.com", "tumblr.com", "whatsapp.com",
]);

async function fetchPressmentions(
  companyName: string,
  domain: string = "",
  industryHint?: string
): Promise<TrustSignals["pressmentions"]> {
  const companySlug = companyName.toLowerCase().replace(/\s+/g, "");
  const domainHost = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];

  // Short/generic company names need disambiguation to avoid noise (a bare
  // company name can collide with unrelated same-named brands or common words).
  // Prefer industry context — real coverage rarely spells out the domain —
  // and fall back to the domain only when no industry hint is available.
  const query = companyName.length <= 6
    ? `"${companyName}" ${industryHint ? industryHint : `"${domainHost}"`} (news OR launch OR raises OR featured OR announces OR startup OR funding) -site:linkedin.com -site:instagram.com -site:facebook.com -site:twitter.com -site:x.com`
    : `"${companyName}" -site:linkedin.com -site:instagram.com -site:facebook.com -site:twitter.com -site:x.com (news OR launch OR raises OR featured OR announces OR startup OR funding)`;

  const data = await serperSearch(query);
  const organic = (data?.organic ?? []) as SerperOrganic[];
  if (organic.length === 0) return { exists: false };

  const companySlugForFilter = companySlug;
  const sources = organic
    .map((r) => {
      const raw = (r.link ?? "")
        .replace(/^https?:\/\/(www\.)?/, "")
        .split("/")[0];
      return raw;
    })
    .filter((d) => d.length > 0 && !d.includes(companySlugForFilter))
    .filter((d) => !SOCIAL_MEDIA_DOMAINS.has(d.toLowerCase()))
    .filter((d) => !["google.com", "bing.com", "yahoo.com", "wikipedia.org", "amazon.com"].includes(d.toLowerCase()))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3);

  if (sources.length === 0) return { exists: false };
  return { exists: true, sources };
}

async function fetchRedditBrandMentions(companyName: string): Promise<TrustSignals["redditMentions"]> {
  const data = await serperSearch(`"${companyName}" site:reddit.com review`);
  const organic = (data.organic ?? []) as SerperOrganic[];
  if (organic.length === 0) return { exists: false };
  const text = organic.map((r) => r.snippet ?? "").join(" ").toLowerCase();
  const positiveWords = ["good", "great", "excellent", "love", "recommend", "best", "helpful", "amazing", "solid", "reliable"];
  const negativeWords = ["bad", "terrible", "awful", "avoid", "worst", "scam", "poor", "slow", "broken", "frustrating"];
  const posScore = positiveWords.filter((w) => text.includes(w)).length;
  const negScore = negativeWords.filter((w) => text.includes(w)).length;
  const sentiment = posScore > negScore ? "positive" : negScore > posScore ? "negative" : "mixed";
  return { exists: true, sentiment, count: organic.length };
}

async function fetchMedium(
  companyName: string,
  domain: string
): Promise<TrustSignals["medium"]> {
  const domainRoot = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split(".")[0];
  const queries = [
    `site:medium.com/@${domainRoot}`,
    `site:medium.com/${domainRoot}`,
    `"${companyName}" site:medium.com author`,
  ];
  for (const query of queries) {
    const data = await serperSearch(query);
    const organic = (data?.organic ?? []) as SerperOrganic[];
    const ownContent = organic.find((r) => {
      const link = (r.link ?? "").toLowerCase();
      const title = (r.title ?? "").toLowerCase();
      return (
        link.includes(`medium.com/@${domainRoot}`) ||
        link.includes(`medium.com/${domainRoot}`) ||
        title.includes(companyName.toLowerCase())
      );
    });
    if (ownContent) return { exists: true };
  }
  return { exists: false };
}

async function fetchSubstack(
  companyName: string,
  domain: string
): Promise<TrustSignals["substack"]> {
  const domainRoot = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split(".")[0];
  const queries = [
    `site:substack.com "${companyName}"`,
    `${domainRoot}.substack.com`,
    `"${companyName}" newsletter substack`,
  ];
  for (const query of queries) {
    const data = await serperSearch(query);
    const organic = (data?.organic ?? []) as SerperOrganic[];
    const ownNewsletter = organic.find((r) => {
      const link = (r.link ?? "").toLowerCase();
      return (
        link.includes("substack.com") &&
        (link.includes(domainRoot) ||
          (r.title ?? "").toLowerCase().includes(companyName.toLowerCase()))
      );
    });
    if (ownNewsletter) return { exists: true };
  }
  return { exists: false };
}

// ─── Social link extraction from website HTML ─────────────────────────────────

async function extractSocialLinksFromHTML(domain: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const result: Record<string, string> = {};

    const yt = html.match(/https?:\/\/(www\.)?youtube\.com\/(channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9_-]+|@[A-Za-z0-9_.-]+|user\/[A-Za-z0-9_-]+)/);
    if (yt) result.youtube = yt[0];

    const li = html.match(/https?:\/\/(www\.)?linkedin\.com\/company\/[A-Za-z0-9_-]+/);
    if (li) result.linkedin = li[0];

    const tw = html.match(/https?:\/\/(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]+/);
    if (tw) result.twitter = tw[0];

    const ig = html.match(/https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+/);
    if (ig) result.instagram = ig[0];

    const fb = html.match(/https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9_.]+/);
    if (fb) result.facebook = fb[0];

    console.log(`[research] Social links from HTML for ${domain}: ${JSON.stringify(result)}`);
    return result;
  } catch {
    return {};
  }
}

async function fetchYoutubePresence(
  companyName: string,
  domain: string,
  socialLinks: Record<string, string> = {}
): Promise<TrustSignals["youtube"]> {
  // Step 0: Check social links extracted from website HTML
  if (socialLinks.youtube) {
    console.log(`[research] YouTube: found in HTML — ${socialLinks.youtube}`);
    return { exists: true, channelUrl: socialLinks.youtube };
  }

  const domainRoot = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split(".")[0];
  const queries = [
    `site:youtube.com/@${domainRoot}`,
    `site:youtube.com/c/${domainRoot}`,
    `site:youtube.com/channel "${companyName}" channel`,
    `"${companyName}" youtube channel`,
    `site:youtube.com "${companyName}"`,
  ];
  for (const query of queries) {
    const data = await serperSearch(query);
    const organic = (data?.organic ?? []) as SerperOrganic[];
    const channelResult = organic.find((r) => {
      const link = r.link ?? "";
      return (
        link.includes("youtube.com/@") ||
        link.includes("youtube.com/c/") ||
        link.includes("youtube.com/channel/") ||
        link.includes("youtube.com/user/")
      );
    });
    if (channelResult) return { exists: true, channelUrl: channelResult.link };
  }
  return { exists: false };
}

const PLATFORM_BLACKLIST = new Set([
  "reddit", "trustpilot", "instagram", "facebook", "twitter", "linkedin",
  "youtube", "forbes", "wikipedia", "google", "amazon", "capterra", "g2",
  "glassdoor", "indeed", "yelp", "quora", "medium", "substack", "crunchbase",
  "techcrunch", "businessinsider", "inc", "entrepreneur", "bloomberg", "reuters",
  "clutch", "pcmag", "cnet", "techradar", "investopedia", "nerdwallet",
]);

async function fetchCompetitors(
  industry: string,
  domain: string,
  companyName: string,
  whatTheySell?: string
): Promise<string[]> {
  const domainRoot = domain.replace(/^(https?:\/\/)?(www\.)?/, "").split(".")[0].toLowerCase();

  const LARGE_ENTERPRISE_BLACKLIST = new Set([
    "mckinsey", "deloitte", "accenture", "ibm", "oracle",
    "salesforce", "sap", "microsoft", "google", "amazon",
    "meta", "apple", "netflix", "adobe", "workday",
    "servicenow", "zendesk", "hubspot", "iqvia", "veeva",
    "mckinseycompany", "pwc", "kpmg", "ey", "bain",
    "bcg", "gartner", "forrester", "idc", "ovum",
    "genentech", "roche", "pfizer", "novartis", "astrazeneca",
  ]);

  const queries = [
    `alternatives to ${companyName} ${industry}`,
    `best ${industry} software companies 2024 2025 startup`,
  ];

  const allResults: string[] = [];

  for (const query of queries) {
    await sleep(500);
    const data = await serperSearch(query);
    const organic = (data?.organic ?? []) as SerperOrganic[];

    for (const r of organic) {
      const rawDomain = (r.link ?? "")
        .replace(/^https?:\/\/(www\.)?/, "")
        .split("/")[0];
      const domainName = rawDomain.split(".")[0];

      if (
        domainName.length >= 3 &&
        !PLATFORM_BLACKLIST.has(domainName.toLowerCase()) &&
        !LARGE_ENTERPRISE_BLACKLIST.has(domainName.toLowerCase()) &&
        !SOCIAL_MEDIA_DOMAINS.has(rawDomain.toLowerCase()) &&
        domainName.toLowerCase() !== domainRoot &&
        domainName.toLowerCase() !== companyName.toLowerCase().split(" ")[0]
      ) {
        allResults.push(domainName.charAt(0).toUpperCase() + domainName.slice(1));
      }
    }

    if (allResults.length >= 3) break;
  }

  // Query 3: category-specific software search using whatTheySell
  if (whatTheySell && allResults.length < 3) {
    await sleep(500);
    const categoryQuery = `"${whatTheySell}" software OR platform -site:linkedin.com -site:reddit.com -site:forbes.com -site:gartner.com`;
    const data3 = await serperSearch(categoryQuery);
    const organic3 = (data3?.organic ?? []) as SerperOrganic[];

    for (const r of organic3) {
      const rawDomain = (r.link ?? "")
        .replace(/^https?:\/\/(www\.)?/, "")
        .split("/")[0];
      const domainName = rawDomain.split(".")[0];

      if (
        domainName.length >= 3 &&
        !PLATFORM_BLACKLIST.has(domainName.toLowerCase()) &&
        !LARGE_ENTERPRISE_BLACKLIST.has(domainName.toLowerCase()) &&
        !SOCIAL_MEDIA_DOMAINS.has(rawDomain.toLowerCase()) &&
        domainName.toLowerCase() !== domainRoot &&
        domainName.toLowerCase() !== companyName.toLowerCase().split(" ")[0]
      ) {
        allResults.push(domainName.charAt(0).toUpperCase() + domainName.slice(1));
      }
    }
  }

  const unique = [...new Set(allResults)].slice(0, 3);
  console.log(`[research] Competitors: ${JSON.stringify(unique)}`);
  return unique;
}

// ─── Physical product trust signal fetchers ───────────────────────────────────

async function fetchIndiaMartListing(companyName: string): Promise<{ exists: boolean; url?: string }> {
  const data = await serperSearch(`site:indiamart.com "${companyName}"`);
  const result = ((data.organic ?? []) as SerperOrganic[])[0];
  if (result?.link?.includes("indiamart.com")) return { exists: true, url: result.link };
  return { exists: false };
}

async function fetchMarketplaceListing(companyName: string): Promise<{ exists: boolean; url?: string }> {
  const data = await serperSearch(`site:amazon.in "${companyName}" OR site:flipkart.com "${companyName}"`);
  const result = ((data.organic ?? []) as SerperOrganic[])[0];
  if (result?.link?.includes("amazon.in") || result?.link?.includes("flipkart.com")) {
    return { exists: true, url: result.link };
  }
  return { exists: false };
}

// ─── Core logic (exported for direct import) ─────────────────────────────────

export async function fetchResearchData(
  industry: string,
  companyName: string,
  domain?: string,
  whatTheySell?: string,
  websiteText?: string,
): Promise<ResearchData> {
  console.log(
    `[research] Fetching for industry="${industry}" company="${companyName}" domain="${domain ?? ""}"`
  );

  const businessType = detectBusinessType(
    whatTheySell ?? '',
    (industry ?? '') + ' ' + (websiteText ?? '')
  );
  console.log(`[research] Business type detected: ${businessType}`);

  // Reddit and social link extraction run in parallel (independent HTTP fetches)
  const redditTitlesPromise = fetchRedditTitles(industry);
  const socialLinksPromise = domain ? extractSocialLinksFromHTML(domain) : Promise.resolve<Record<string, string>>({});

  // Serper calls run sequentially with 500ms between each to avoid rate limits
  const peopleAlsoAsk = await fetchPeopleAlsoAsk(industry);
  await sleep(500);
  const quoraTitles = await fetchQuoraTitles(industry, companyName);
  await sleep(500);
  const youtubeTitles = await fetchYoutubeTitles(industry);
  await sleep(500);

  // Review platform checks depend on business type
  let trustpilot: TrustSignals["trustpilot"];
  let g2: TrustSignals["g2"];
  let capterra: TrustSignals["capterra"];
  let indiamartListing: TrustSignals["indiamartListing"];
  let marketplaceListing: TrustSignals["marketplaceListing"];

  if (businessType === 'physical') {
    trustpilot = { exists: false };
    g2 = { exists: false };
    capterra = { exists: false };
    indiamartListing = await fetchIndiaMartListing(companyName);
    await sleep(500);
    marketplaceListing = await fetchMarketplaceListing(companyName);
    await sleep(500);
  } else {
    trustpilot = await fetchTrustpilot(companyName, domain ?? "");
    await sleep(500);
    g2 = await fetchG2(companyName, domain ?? "");
    await sleep(500);
    capterra = await fetchCapterra(companyName, domain ?? "");
    await sleep(500);
    indiamartListing = { exists: false };
    marketplaceListing = { exists: false };
  }
  const faqPage: TrustSignals["faqPage"] = domain
    ? await fetchFaqPage(domain)
    : { exists: false };
  await sleep(500);
  const aboutPage: TrustSignals["aboutPage"] = domain
    ? await fetchAboutPage(domain)
    : { exists: false, hasExperience: false, hasCustomerCount: false, hasCertifications: false, hasAwards: false };
  await sleep(500);
  const pressmentions = await fetchPressmentions(companyName, domain ?? "", industry);
  await sleep(500);
  const redditMentions = await fetchRedditBrandMentions(companyName);
  await sleep(500);
  const medium = await fetchMedium(companyName, domain ?? "");
  await sleep(500);
  const substack = await fetchSubstack(companyName, domain ?? "");
  await sleep(500);
  // Await social links here (started in parallel at the top)
  const socialLinks = await socialLinksPromise;
  const youtube = await fetchYoutubePresence(companyName, domain ?? "", socialLinks);
  await sleep(500);
  const competitors = await fetchCompetitors(industry, domain ?? "", companyName, whatTheySell);

  const redditTitles = await redditTitlesPromise;
  const linkedinPage: TrustSignals["linkedinPage"] = socialLinks.linkedin
    ? { exists: true, url: socialLinks.linkedin }
    : { exists: false };

  // Aggregate customer language from real phrases across all sources
  const customerLanguage = [
    ...redditTitles.slice(0, 4),
    ...youtubeTitles.slice(0, 4),
    ...quoraTitles.slice(0, 4),
    ...peopleAlsoAsk.slice(0, 3),
  ]
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 15);

  const trustSignals: TrustSignals = {
    trustpilot,
    g2,
    capterra,
    indiamartListing,
    marketplaceListing,
    faqPage,
    aboutPage,
    pressmentions,
    redditMentions,
    medium,
    substack,
    youtube,
    linkedinPage,
    competitors,
    customerLanguage,
  };

  return { peopleAlsoAsk, redditTitles, youtubeTitles, quoraTitles, trustSignals, businessType };
}

// ─── Route handler ────────────────────────────────────────────────────────────

async function handlePost(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkResearchRateLimit(ip)) {
    return NextResponse.json(
      { error: "rate_limit", message: "Too many requests. Try again in 24 hours." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json() as { industry?: unknown; companyName?: unknown; domain?: unknown; whatTheySell?: unknown };
    const { industry, companyName, domain, whatTheySell } = body;

    if (!industry || typeof industry !== "string") {
      return NextResponse.json({ error: "industry is required" }, { status: 400 });
    }

    const result = await fetchResearchData(
      industry,
      typeof companyName === "string" ? companyName : "",
      typeof domain === "string" ? domain : undefined,
      typeof whatTheySell === "string" ? whatTheySell : undefined
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[research] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = measuredRoute("research", handlePost);
