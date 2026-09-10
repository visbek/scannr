import { measuredRoute } from "@/lib/scan-usage";
import { generateKeywords } from "@/lib/scan-keywords";
import { NextRequest, NextResponse } from "next/server";

// ─── IP rate limiting ─────────────────────────────────────────────────────────

interface RateLimitEntry { count: number; resetTime: number }
const keywordsRateLimitMap = new Map<string, RateLimitEntry>();
const KEYWORDS_RATE_LIMIT_MAX = 3;
const KEYWORDS_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function checkKeywordsRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = keywordsRateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    keywordsRateLimitMap.set(ip, { count: 1, resetTime: now + KEYWORDS_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= KEYWORDS_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

async function handlePost(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkKeywordsRateLimit(ip)) {
    return NextResponse.json(
      { error: "rate_limit", message: "Too many requests. Try again in 24 hours." },
      { status: 429 }
    );
  }

  try {
    const { domain, industry, companyName, whatTheySell, buyerLocation } =
      await request.json();

    if (!industry || !companyName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const keywords = await generateKeywords({ domain, industry, companyName, whatTheySell, buyerLocation });
    return NextResponse.json(keywords);
  } catch (err) {
    console.error("[keywords] error:", err);
    return NextResponse.json({ error: "Failed to generate keywords" }, { status: 500 });
  }
}

export const POST = measuredRoute("keywords", handlePost);
