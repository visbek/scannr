"use client";

import { useState, useEffect, useRef } from "react";
import { HeroSection } from "@/components/scanner/HeroSection";
import { ScanningAnimation } from "@/components/scanner/ScanningAnimation";
import { ResultsSection } from "@/components/scanner/ResultsSection";
import {
  type ScanData,
  type ScanStatus,
  type EngineState,
  type ScanHistoryEntry,
} from "@/components/scanner/types";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import type { KeywordsData } from "@/components/scanner/ResultsSection";

async function fetchScanHistory(domain: string): Promise<ScanHistoryEntry[]> {
  const { data, error } = await supabase
    .from("scans")
    .select("created_at, score, gemini_score, claude_score, chatgpt_score, perplexity_score")
    .eq("domain", domain)
    .not("score", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return data ?? [];
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [rateLimited, setRateLimited] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);

  // Keywords state
  const [keywordsData, setKeywordsData] = useState<KeywordsData | null>(null);
  const [keywordsLoading, setKeywordsLoading] = useState(false);

  // Email wall state
  const [emailCaptured, setEmailCaptured] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  // Scan animation state
  const [engineStates, setEngineStates] = useState<Record<string, EngineState>>({
    gemini: "idle",
    claude: "idle",
    chatgpt: "idle",
    perplexity: "idle",
  });
  const [scanTextIdx, setScanTextIdx] = useState(0);

  const resultsRef = useRef<HTMLDivElement | null>(null);

  // ── URL param auto-scan ──────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlDomain = params.get("domain");
    if (urlDomain) {
      setDomain(urlDomain);
      handleScan(urlDomain);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth state ───────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── localStorage ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (scanData && domain) {
      const nd = domain.trim().toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "");
      if (localStorage.getItem(`scanrr_scanned_${nd}`)) {
        setEmailCaptured(true);
      } else {
        setEmailCaptured(false);
      }
    }
  }, [scanData, domain]);

  // ── Cycling scan text ────────────────────────────────────────────────────────

  useEffect(() => {
    if (status !== "generating" && status !== "scanning") return;
    const id = setInterval(() => setScanTextIdx((i) => i + 1), 2000);
    return () => clearInterval(id);
  }, [status]);

  // ── Engine state machine ─────────────────────────────────────────────────────

  useEffect(() => {
    if (status === "done") {
      setEngineStates({ gemini: "done", claude: "done", chatgpt: "done", perplexity: "done" });
      return;
    }
    if (status !== "scanning") {
      setEngineStates({ gemini: "idle", claude: "idle", chatgpt: "idle", perplexity: "idle" });
      return;
    }
    const engines = ["gemini", "claude", "chatgpt", "perplexity"] as const;
    const timers: ReturnType<typeof setTimeout>[] = [];
    engines.forEach((eng, i) => {
      timers.push(setTimeout(() => setEngineStates((p) => ({ ...p, [eng]: "scanning" })), i * 300));
      timers.push(setTimeout(() => setEngineStates((p) => ({ ...p, [eng]: "analyzing" })), 28000 + i * 4000));
    });
    return () => timers.forEach(clearTimeout);
  }, [status]);

  // ── Scroll to results ────────────────────────────────────────────────────────

  useEffect(() => {
    if (status === "done") {
      setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        300
      );
    }
  }, [status]);

  // ── Scan handler ─────────────────────────────────────────────────────────────

  async function handleScan(inputDomain: string) {
    const trimmed = inputDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!trimmed) return;
    const flowId = crypto.randomUUID();
    setScanData(null);
    setScanHistory([]);
    setKeywordsData(null);
    setKeywordsLoading(false);
    setRateLimited(false);
    setErrorMessage("");
    setEmailCaptured(false);
    setStatus("generating");
    setScanTextIdx(0);

    try {
      const r1 = await fetch("/api/scan/generate-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-scan-flow-id": flowId },
        body: JSON.stringify({ domain: trimmed }),
      });
      if (r1.status === 429) {
        setRateLimited(true);
        setStatus("error");
        return;
      }
      if (!r1.ok) throw new Error("Failed to generate prompts");
      const icpData = await r1.json();
      setStatus("scanning");

      const { data: { session } } = await supabase.auth.getSession();
      const r2 = await fetch("/api/scan/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-scan-flow-id": flowId, ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          domain: trimmed,
          businessProfile: icpData.businessProfile,
          icp: icpData.icp,
          prompts: icpData.prompts,
          brandVariations: icpData.brandVariations,
          competitors: icpData.competitors?.slice(0, 3),
          businessType: icpData.businessType,
          trustSignals: icpData.trustSignals,
        }),
      });
      if (!r2.ok) {
        if (r2.status === 429) setRateLimited(true);
        const failure = await r2.json().catch(() => ({}));
        throw new Error(failure.message || failure.error || "Scan could not be completed. Try again.");
      }
      const data = await r2.json();
      setScanData({ ...data, domain: trimmed, businessProfile: icpData.businessProfile, icp: icpData.icp, trustSignals: icpData.trustSignals, businessType: icpData.businessType });
      setStatus("done");

      setKeywordsData(data.keywordsData ?? null);
      setKeywordsLoading(false);
      if (data.saveStatus === "saved") fetchScanHistory(trimmed).then(setScanHistory);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Scan could not be completed. Try again.");
      setStatus("error");
    }
  }

  // ── Email handler ────────────────────────────────────────────────────────────

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailInput.trim()) return;
    setEmailSubmitting(true);
    try {
      const nd = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
      const topKeywords = [
        ...(keywordsData?.tier1 ?? []),
        ...(keywordsData?.tier2 ?? []),
        ...(keywordsData?.tier3 ?? []),
      ].slice(0, 3).map((k) => k.keyword);
      await fetch("/api/leads/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.trim(),
          domain: nd,
          score: scanData?.overallScore ?? null,
          keywords: topKeywords,
        }),
      });
      localStorage.setItem("scanrr_email", emailInput.trim());
      localStorage.setItem(`scanrr_scanned_${nd}`, "true");
      setEmailCaptured(true);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    } catch {
      localStorage.setItem("scanrr_email", emailInput.trim());
      setEmailCaptured(true);
    } finally {
      setEmailSubmitting(false);
    }
  }

  const isLoading = status === "generating" || status === "scanning";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main
      className="min-h-screen overflow-x-hidden"
      style={{ background: "#F5F1EA", color: "#0E1F18" }}
    >
      {/* Nav */}
      <nav
        className="sticky top-0 z-40 px-6 py-4"
        style={{
          background: "#F5F1EA",
          borderBottom: "1px solid #D8D2C8",
        }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          {/* Logo */}
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span
              style={{
                fontFamily: "var(--font-sans, system-ui)",
                fontWeight: 700,
                fontSize: 16,
                color: "#0E1F18",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}
            >
              Scanrr
            </span>
            <a
              href="https://sparrwo.com"
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
                color: "#888",
                textDecoration: "none",
                lineHeight: 1.2,
              }}
            >
              by sparrwo.com
            </a>
          </div>

          {/* Nav CTA */}
          {user ? (
            <a
              href="/dashboard"
              style={{
                background: "#1A3A2E",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-sans, system-ui)",
                cursor: "pointer",
                transition: "background 150ms ease",
                textDecoration: "none",
                display: "inline-block",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#C8B89A")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#1A3A2E")}
            >
              Dashboard
            </a>
          ) : (
            <a
              href="/login"
              style={{
                background: "#1A3A2E",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-sans, system-ui)",
                cursor: "pointer",
                transition: "background 150ms ease",
                textDecoration: "none",
                display: "inline-block",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#C8B89A")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#1A3A2E")}
            >
              Sign In
            </a>
          )}
        </div>
      </nav>

      {/* Hero + marketing */}
      <HeroSection
        domain={domain}
        status={status}
        onDomainChange={setDomain}
        onScan={handleScan}
      />

      {status === "error" && (
        <p role="alert" className="mx-auto max-w-3xl px-6 py-4 text-center text-amber-800">
          {rateLimited ? "You have reached the daily scan limit. Try again in 24 hours." : errorMessage}
        </p>
      )}
      {status === "done" && scanData && (
        <div className="mx-auto max-w-3xl px-6 py-4 text-center" role="status">
          {scanData.saveStatus === "saved" && <a className="underline" href={`/reports/${scanData.reportId}`}>Report saved — open permanent report</a>}
          {scanData.saveStatus === "failed" && <p className="text-amber-800">Your scan finished, but the report could not be saved. Download the PDF now to keep a copy.</p>}
          {scanData.saveStatus === "anonymous" && <p>This scan is not saved to an account. <a className="underline" href="/login">Sign in</a> before your next scan to save reports.</p>}
        </div>
      )}

      {/* Scanning animation */}
      {isLoading && (
        <ScanningAnimation
          status={status}
          engineStates={engineStates}
          textIdx={scanTextIdx}
        />
      )}

      {/* Results */}
      {status === "done" && scanData && (
        <ResultsSection
          scanData={scanData}
          scanHistory={scanHistory}
          keywordsData={keywordsData}
          keywordsLoading={keywordsLoading}
          emailCaptured={emailCaptured}
          emailInput={emailInput}
          emailFocused={emailFocused}
          emailSubmitting={emailSubmitting}
          showToast={showToast}
          onEmailChange={setEmailInput}
          onEmailFocus={setEmailFocused}
          onEmailSubmit={handleEmailSubmit}
          sectionRef={resultsRef}
        />
      )}

      {/* Footer */}
      <footer
        style={{
          background: "#0a0a0a",
          borderTop: "1px solid #1a1a1a",
          padding: "40px 24px",
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 400,
              fontSize: 12,
              color: "#666660",
            }}
          >
            Powered by Scanrr — a{" "}
              <a
                href="https://sparrwo.com"
                style={{
                  color: "inherit",
                  textDecoration: "none",
                  borderBottom: "1px solid transparent",
                  transition: "border-color 150ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderBottomColor = "#666660")}
                onMouseLeave={(e) => (e.currentTarget.style.borderBottomColor = "transparent")}
              >
                Sparrwo
              </a>{" "}
              tool
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <span
            suppressHydrationWarning
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              color: "#666660",
            }}
          >
            © 2026
          </span>
          <span style={{ color: "#2a2a2a", margin: "0 10px" }}>·</span>
          <a
            href="/privacy"
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              color: "#666660",
              textDecoration: "none",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#666660")}
          >
            Privacy
          </a>
          <span style={{ color: "#2a2a2a", margin: "0 10px" }}>·</span>
          <a
            href="/terms"
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              color: "#666660",
              textDecoration: "none",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#666660")}
          >
            Terms
          </a>
        </div>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebApplication",
                "@id": "https://scanrr.sparrwo.com/#webapp",
                "name": "Scanrr",
                "url": "https://scanrr.sparrwo.com",
                "description": "Free AI visibility checker. See where your brand appears on ChatGPT, Perplexity, Gemini and Claude across 24 buyer intent prompts.",
                "applicationCategory": "BusinessApplication",
                "operatingSystem": "Web",
                "offers": {
                  "@type": "Offer",
                  "price": "0",
                  "priceCurrency": "USD",
                  "description": "Free AI visibility scan",
                },
                "creator": {
                  "@type": "Organization",
                  "name": "Sparrwo",
                  "url": "https://sparrwo.com",
                },
                "featureList": [
                  "ChatGPT brand visibility check",
                  "Perplexity brand visibility check",
                  "Gemini brand visibility check",
                  "Claude brand visibility check",
                  "24 buyer intent prompts",
                  "AI citation score",
                  "Trust signals analysis",
                  "Keyword recommendations",
                ],
              },
              {
                "@type": "Organization",
                "@id": "https://sparrwo.com/#org",
                "name": "Sparrwo",
                "url": "https://sparrwo.com",
                "description": "AI Visibility Agency for B2B SaaS and professional services",
                "founder": {
                  "@type": "Person",
                  "name": "Vishal Thakur",
                },
              },
              {
                "@type": "FAQPage",
                "mainEntity": [
                  {
                    "@type": "Question",
                    "name": "What is AI visibility?",
                    "acceptedAnswer": {
                      "@type": "Answer",
                      "text": "AI visibility refers to how often and how prominently your brand appears when buyers ask AI tools like ChatGPT, Perplexity, Gemini or Claude for recommendations in your category.",
                    },
                  },
                  {
                    "@type": "Question",
                    "name": "How does Scanrr work?",
                    "acceptedAnswer": {
                      "@type": "Answer",
                      "text": "Enter your domain and Scanrr runs 24 real buyer intent prompts across 4 AI engines — ChatGPT, Perplexity, Gemini, and Claude. It detects whether your brand is cited and gives you a visibility score with specific gaps to fix.",
                    },
                  },
                  {
                    "@type": "Question",
                    "name": "Is Scanrr free?",
                    "acceptedAnswer": {
                      "@type": "Answer",
                      "text": "Yes. The AI visibility scan is completely free. No account required. Results in under 60 seconds.",
                    },
                  },
                  {
                    "@type": "Question",
                    "name": "Which AI engines does Scanrr check?",
                    "acceptedAnswer": {
                      "@type": "Answer",
                      "text": "Scanrr checks ChatGPT (GPT-4o), Perplexity, Google Gemini, and Anthropic Claude — the four AI tools most used by B2B buyers for research and vendor discovery.",
                    },
                  },
                ],
              },
            ],
          }),
        }}
      />
    </main>
  );
}
