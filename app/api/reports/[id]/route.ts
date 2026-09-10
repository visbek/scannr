import { NextRequest, NextResponse } from "next/server";
import { readReport, reportSession } from "@/lib/report-store";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  let session;
  try { session = await reportSession(request.headers.get("authorization")); }
  catch { return NextResponse.json({ error: "Sign in to view this report." }, { status: 401, headers }); }
  if (!session) return NextResponse.json({ error: "Sign in to view this report." }, { status: 401, headers });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Report not found." }, { status: 404, headers });
  }
  try {
    const { data, error } = await readReport(session, id);
    if (error) return NextResponse.json({ error: "Report could not be loaded. Try again." }, { status: 503, headers });
    if (!data) return NextResponse.json({ error: "Report not found or unavailable to this account." }, { status: 404, headers });
    return NextResponse.json(data, { headers });
  } catch {
    return NextResponse.json({ error: "Report could not be loaded. Try again." }, { status: 503, headers });
  }
}
