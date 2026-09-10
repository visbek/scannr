"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { restoreReport, type SavedScanRow } from "@/lib/report-snapshot";
import { ResultsSection } from "@/components/scanner/ResultsSection";

export function SavedReport({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof restoreReport> | null>(null);
  const [error, setError] = useState("");
  const sectionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Sign in, then reopen this report from your dashboard.");
        const response = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Report could not be loaded.");
        if (!controller.signal.aborted) setSnapshot(restoreReport(data as SavedScanRow));
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Report could not be loaded.");
      }
    };
    void load();
    return () => controller.abort();
  }, [id]);
  return (
    <main className="min-h-screen bg-[#F5F1EA] text-[#0E1F18]">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-6">
        <Link className="underline" href="/dashboard">Back to dashboard</Link>
        <Link className="underline" href="/">Run a new scan</Link>
      </header>
      {error ? <div role="alert" className="mx-auto max-w-3xl p-6"><p>{error}</p><Link className="underline" href="/login">Sign in</Link></div>
        : !snapshot ? <p role="status" className="p-6 text-center">Loading saved report…</p> : <>
          <div className="mx-auto max-w-3xl px-6 py-4">
            <h1 className="text-2xl font-semibold">Saved report: {snapshot.report.domain}</h1>
            <p>{new Date(snapshot.report.createdAt!).toLocaleString()}</p>
            {snapshot.legacy && <p className="mt-3 text-amber-800">This historical report uses the previous scoring method. Some report details were not saved. No new scan has been run.</p>}
          </div>
          <ResultsSection scanData={snapshot.report} keywordsData={snapshot.keywordsData}
            keywordsLoading={false} emailCaptured={true} emailInput="" emailFocused={false}
            emailSubmitting={false} showToast={false} onEmailChange={() => {}} onEmailFocus={() => {}}
            onEmailSubmit={(event) => event.preventDefault()} sectionRef={sectionRef} />
        </>}
    </main>
  );
}
