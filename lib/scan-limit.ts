import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type ScanAction = "run" | "research" | "generate-prompts" | "keywords";
type Consume = (subject: string, action: ScanAction) => Promise<unknown>;

// Injecting the store lets tests verify failure handling without provider calls.
export async function scanLimitResponse(headers: Headers, action: ScanAction, consume?: Consume): Promise<Response | null> {
  try {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!secret || !url) throw new Error("Missing quota configuration");
    // Vercel overwrites x-forwarded-for at its ingress. Never store the raw IP.
    const ip = headers.get("x-forwarded-for")?.split(",")[0].trim();
    if (!ip) throw new Error("Missing client address");
    const subject = createHmac("sha256", secret).update("scan-limit-v1:" + ip).digest("hex");
    const call = consume ?? (async (subject, action) => {
      const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.rpc("consume_scan_limit", { p_subject: subject, p_action: action }).abortSignal(AbortSignal.timeout(5000));
      if (error) throw error;
      return data;
    });
    const data = await call(subject, action);
    if (!Array.isArray(data) || data.length !== 1 || typeof data[0]?.allowed !== "boolean" || !Number.isInteger(data[0]?.retry_after)) throw new Error("Invalid quota response");
    if (data[0].allowed) return null;
    return Response.json({ error: "rate_limit", message: "Your free request limit has been reached. Please try again after the limit resets." }, { status: 429, headers: { "Retry-After": String(Math.max(1, data[0].retry_after)), "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "limit_unavailable", message: "Scanning is temporarily unavailable. Please try again later." }, { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  }
}
