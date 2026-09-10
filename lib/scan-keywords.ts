import { searchSerper } from "./serper";
import { providerFetch } from "./scan-usage";
import Anthropic from "@anthropic-ai/sdk";
import type { KeywordsData } from "@/components/scanner/ResultsSection";


async function serperSearch(query: string): Promise<{ organic: { title: string }[]; peopleAlsoAsk: { question: string }[] }> {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return { organic: [], peopleAlsoAsk: [] };
  try {
    const data = await searchSerper(query) as { organic?: { title: string }[]; peopleAlsoAsk?: { question: string }[] };
    return {
      organic: data.organic ?? [],
      peopleAlsoAsk: data.peopleAlsoAsk ?? [],
    };
  } catch {
    return { organic: [], peopleAlsoAsk: [] };
  }
}

async function redditSearch(industry: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(industry + " recommendations")}&sort=relevance&limit=10`,
      { headers: { "User-Agent": "sparrwo/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.children ?? []).map(
      (c: { data: { title: string } }) => c.data.title
    );
  } catch {
    return [];
  }
}

export async function generateKeywords({ domain, industry, companyName, whatTheySell, buyerLocation }: {
  domain: string; industry: string; companyName: string; whatTheySell: string; buyerLocation: string;
}): Promise<KeywordsData> {
    // Run all 4 searches in parallel
    const [highIntent, comparison, reddit, alternatives] = await Promise.all([
      serperSearch(`${whatTheySell || industry} ${buyerLocation} providers pricing`.trim()),
      serperSearch(`best ${industry} for comparison`),
      redditSearch(whatTheySell || industry),
      serperSearch(`${companyName} alternatives ${industry}`),
    ]);

    const allSerperData = [
      "=== HIGH INTENT SEARCH ===",
      highIntent.organic.map((r) => r.title).join("\n"),
      highIntent.peopleAlsoAsk.map((r) => r.question).join("\n"),
      "=== COMPARISON SEARCH ===",
      comparison.organic.map((r) => r.title).join("\n"),
      comparison.peopleAlsoAsk.map((r) => r.question).join("\n"),
      "=== ALTERNATIVES SEARCH ===",
      alternatives.organic.map((r) => r.title).join("\n"),
      alternatives.peopleAlsoAsk.map((r) => r.question).join("\n"),
    ]
      .filter(Boolean)
      .join("\n");

    const redditTitles = reddit.join("\n") || "No Reddit data available";

    const client = new Anthropic({ fetch: providerFetch("keywords"), apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 0 });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are a keyword strategist for B2B companies.

Company: ${companyName}
What they sell: ${whatTheySell}
Industry: ${industry}
Target buyer location: ${buyerLocation}
Domain: ${domain}

Real search data from the internet:
${allSerperData}

Reddit buyer questions:
${redditTitles}

Based on this REAL data, generate keyword recommendations in 3 tiers.

IMPORTANT RULES:
- Tier 1 (HIGH INTENT): Queries expressing purchase or vendor-selection intent for this company's actual offering. Use supplier/manufacturer language only for relevant physical products, and use locations only when present in the buyer profile. Do not assume India or promise sales pipeline.

- Tier 2 (MID INTENT): Comparison, ROI, alternatives, best-for queries. These get cited by LLMs and influence decisions. Example: 'best water saving devices for commercial buildings ROI'

- Tier 3 (AWARENESS): Informational, educational, how-to queries. These build authority and top-of-funnel traffic. Example: 'how to reduce water consumption in office building'

For each keyword also provide:
- searchVolume: always 'Not measured'. Search result counts do not measure query volume.
- llmPotential: 'High/Medium/Low' as a qualitative prioritization hypothesis, never a measured citation probability
- why: one sentence explaining why this keyword matters

Return ONLY valid JSON with no markdown, no code fences:
{
  "tier1": [{ "keyword": "", "searchVolume": "", "llmPotential": "", "why": "" }],
  "tier2": [{ "keyword": "", "searchVolume": "", "llmPotential": "", "why": "" }],
  "tier3": [{ "keyword": "", "searchVolume": "", "llmPotential": "", "why": "" }]
}

Generate up to 8 keywords per tier. Return fewer when research is insufficient. Make them SPECIFIC to this company, not generic. Never invent facts to fill the list.`,
        },
      ],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const keywords = JSON.parse(cleaned);

    if (!["tier1", "tier2", "tier3"].every((tier) => Array.isArray(keywords[tier]) && keywords[tier].every((item: Record<string, unknown>) =>
      item && ["keyword", "searchVolume", "llmPotential", "why"].every((key) => typeof item[key] === "string")))) {
      throw new Error("Invalid keyword response");
    }
    for (const tier of ["tier1", "tier2", "tier3"] as const) {
      keywords[tier] = keywords[tier].slice(0, 8).map((item: KeywordsData["tier1"][number]) => ({
        ...item, searchVolume: "Not measured",
      }));
    }
    return keywords as KeywordsData;
}
