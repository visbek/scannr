"use client";

import { useRef, useState } from "react";
import { ResultsSection } from "./ResultsSection";
import { makeDemoReport, type DemoScenario } from "@/lib/demo-report";

const scenarios: { value: DemoScenario; label: string }[] = [
  { value: "partial", label: "Some checks unavailable" },
  { value: "unavailable", label: "All checks unavailable" },
  { value: "complete", label: "All checks completed" },
];

export function DemoReport() {
  const [scenario, setScenario] = useState<DemoScenario>("partial");
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const report = makeDemoReport(scenario);
  return <main className="min-h-screen bg-[#F5F1EA] text-[#0E1F18]">
    <header className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <p className="font-mono text-sm uppercase tracking-widest">Scanrr · local demo · $0 in API calls</p>
      <h1 className="text-3xl font-bold">Check the report without running a scan</h1>
      <p>This uses the revised report component with fictional sample answers. It shows how scoring and unavailable checks are displayed. It does not prove the accuracy of real AI answers.</p>
      <p className="rounded border border-amber-300 bg-amber-50 p-4">Live scans, email, sign-in and database routes are blocked in this demo. No API keys are needed.</p>
      <div className="flex flex-wrap gap-3" aria-label="Sample scenarios">
        {scenarios.map(({ value, label }) => <button key={value} type="button" aria-pressed={scenario === value}
          className={`rounded border px-4 py-3 text-sm ${scenario === value ? "bg-[#0E1F18] text-white" : "bg-white"}`}
          onClick={() => setScenario(value)}>{label}</button>)}
      </div>
      <p role="status">Sample coverage: {report.coverage?.successful}/{report.coverage?.total} completed checks. Score: {report.overallScore ?? "unavailable"}.</p>
    </header>
    <ResultsSection key={scenario} scanData={report} keywordsData={null} keywordsLoading={false}
      emailCaptured={true} emailInput="" emailFocused={false} emailSubmitting={false} showToast={false}
      onEmailChange={() => {}} onEmailFocus={() => {}} onEmailSubmit={(event) => event.preventDefault()} sectionRef={sectionRef} />
  </main>;
}
