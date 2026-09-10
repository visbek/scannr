import { createClient } from "@supabase/supabase-js";
import type { ScanData } from "@/components/scanner/types";
import type { KeywordsData } from "@/components/scanner/ResultsSection";

// Each request has a separate client carrying the user's JWT. No service-role
// client is used: RLS remains active for both saving and reading reports.
export async function reportSession(authorization: string | null) {
  if (!authorization) return null;
  if (!/^Bearer \S+$/i.test(authorization)) throw new Error("Unauthorized");
  const token = authorization.slice(7);
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }),
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return { db, userId: data.user.id };
}

export type ReportSession = NonNullable<Awaited<ReturnType<typeof reportSession>>>;

export async function saveReport(session: ReportSession, report: ScanData, keywordsData: KeywordsData | null) {
  const { data, error } = await session.db.from("scans").insert({
    user_id: session.userId, domain: report.domain,
    score: report.overallScore,
    gemini_score: report.engines.gemini.score,
    claude_score: report.engines.claude.score,
    chatgpt_score: report.engines.chatgpt.score,
    perplexity_score: report.engines.perplexity.score,
    icp_data: { ...report.businessProfile, ...report.icp },
    // Existing JSONB column: no production schema change is required.
    results: { version: 2, report, keywordsData },
  }).select("id").single();
  if (error || !data) throw new Error("Report could not be saved");
  return data.id as string;
}

export async function readReport(session: ReportSession, id: string) {
  return session.db.from("scans")
    .select("id, domain, score, created_at, gemini_score, claude_score, chatgpt_score, perplexity_score, icp_data, results")
    .eq("id", id).eq("user_id", session.userId).maybeSingle();
}
