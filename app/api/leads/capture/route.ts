import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── IP rate limiting: 10 per IP per hour ────────────────────────────────────

interface RateLimitEntry { count: number; resetTime: number }
const leadRateMap = new Map<string, RateLimitEntry>();
const LEAD_RATE_LIMIT_MAX = 10;
const LEAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkLeadRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = leadRateMap.get(ip);
  if (!entry || now > entry.resetTime) {
    leadRateMap.set(ip, { count: 1, resetTime: now + LEAD_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= LEAD_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Email validation ─────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  const atIdx = email.indexOf("@");
  if (atIdx < 1) return false;
  const domain = email.slice(atIdx + 1);
  return domain.includes(".") && domain.length > 2;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkLeadRateLimit(ip)) {
    return NextResponse.json(
      { error: "rate_limit", message: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();

    // Sanitize and validate email
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    // Sanitize domain
    const domain =
      typeof body.domain === "string" ? body.domain.trim().slice(0, 100) : null;

    // Sanitize score
    const rawScore = body.score === null || body.score === undefined || body.score === ""
      ? NaN : typeof body.score === "number" ? body.score : Number(body.score);
    const score =
      !isNaN(rawScore) && rawScore >= 0 && rawScore <= 100 ? rawScore : null;

    // Sanitize keywords (top 3 strings)
    const rawKeywords = Array.isArray(body.keywords) ? body.keywords : [];
    const keywords: string[] = rawKeywords
      .filter((k: unknown) => typeof k === "string")
      .slice(0, 3);

    const timestamp = new Date().toISOString();
    console.log(`[leads/capture] email="${email}" domain="${domain}" score=${score} keywords=${JSON.stringify(keywords)}`);

    // 1. Save to Supabase FIRST
    let supabaseSaved = false;
    try {
      const { error: dbError } = await supabaseAdmin
        .from("leads")
        .insert({ email, domain, score });
      if (dbError) {
        console.error("[leads/capture] Supabase insert error:", dbError);
      } else {
        supabaseSaved = true;
      }
    } catch (dbErr) {
      console.error("[leads/capture] Supabase insert exception:", dbErr);
    }

    // 2. Send notification email (always attempt, even if Supabase failed)
    const keywordRows = keywords.length
      ? keywords.map((k, i) => `<tr><td style="padding:4px 0;color:#555;font-size:13px;">${i + 1}.</td><td style="padding:4px 8px;font-size:13px;">${k}</td></tr>`).join("")
      : `<tr><td colspan="2" style="padding:4px 0;color:#999;font-size:13px;">(none captured)</td></tr>`;

    const dbBadge = supabaseSaved
      ? `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">saved</span>`
      : `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">FAILED — check logs</span>`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e5e0;border-radius:8px;overflow:hidden;max-width:560px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#1A3A2E;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;font-family:monospace;">Scanrr · New Lead</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px;">

          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e0;border-radius:6px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#f7f7f5;">
              <td style="padding:10px 16px;font-size:11px;color:#999;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;width:110px;">Email</td>
              <td style="padding:10px 16px;font-size:13px;color:#0a0a0a;font-weight:600;">${email}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:11px;color:#999;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;">Domain</td>
              <td style="padding:10px 16px;font-size:13px;color:#0a0a0a;">${domain ?? "(unknown)"}</td>
            </tr>
            <tr style="background:#f7f7f5;">
              <td style="padding:10px 16px;font-size:11px;color:#999;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;">Score</td>
              <td style="padding:10px 16px;font-size:13px;color:#0a0a0a;">${score !== null ? `${score}/100` : "(unknown)"}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:11px;color:#999;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;">DB</td>
              <td style="padding:10px 16px;">${dbBadge}</td>
            </tr>
            <tr style="background:#f7f7f5;">
              <td style="padding:10px 16px;font-size:11px;color:#999;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;">Time</td>
              <td style="padding:10px 16px;font-size:12px;color:#555;font-family:monospace;">${timestamp}</td>
            </tr>
          </table>

          <p style="margin:0 0 10px;font-size:11px;color:#999;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;">Top Keywords</p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">${keywordRows}</table>

          <a href="https://supabase.com/dashboard"
             style="display:inline-block;background:#1A3A2E;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;">
            View in Supabase →
          </a>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      await resend.emails.send({
        from: "sparrwo@boringmonkee.com",
        to: "vishal@boringmonkee.com",
        subject: `New Scanrr Lead — ${domain ?? email}`,
        html,
      });
    } catch (emailErr) {
      console.error("[leads/capture] Resend notification error:", emailErr);
    }

    // 3. Add contact to Resend — triggers AIO Checker email sequence
    resend.contacts.create({
      email,
      audienceId: 'c27baf71-4917-4f2b-8cd8-8f02387c1ffb',
      unsubscribed: false,
    }).catch((err: unknown) => {
      console.error('[leads/capture] Resend contact error:', err);
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
