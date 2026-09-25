import { scanLimitResponse } from "@/lib/scan-limit";
import { measuredRoute } from "@/lib/scan-usage";
import { generateKeywords } from "@/lib/scan-keywords";
import { NextRequest, NextResponse } from "next/server";

// ─── IP rate limiting ─────────────────────────────────────────────────────────



async function handlePost(request: NextRequest) {
  const limited = await scanLimitResponse(request.headers, "keywords");
  if (limited) return limited;

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
