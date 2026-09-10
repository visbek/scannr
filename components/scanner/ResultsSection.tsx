"use client";

import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { keywordsFromPrompts, KEYWORD_FALLBACK_NOTE } from "@/lib/keyword-fallback";
import { ScoreCircle } from "@/components/scanner/ScoreCircle";
import {
  type ScanData,
  type Category,
  type EngineResult,
  type PromptResult,
  type CategoryScore,
  type TrustSignals,
  type ScanHistoryEntry,
} from "@/components/scanner/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const ENGINES = [
  { key: "gemini" as const, label: "Gemini", color: "#4285f4", weight: 15 },
  { key: "claude" as const, label: "Claude", color: "#d97706", weight: 25 },
  { key: "chatgpt" as const, label: "ChatGPT", color: "#10a37f", weight: 25 },
  { key: "perplexity" as const, label: "Perplexity", color: "#f97316", weight: 35 },
];

const CATEGORIES = [
  {
    key: "informational" as Category,
    label: "Informational",
    description: "Buyer learning about the problem",
    badgeStyle: {
      border: "1px solid #bfdbfe",
      color: "#2563eb",
      background: "#eff6ff",
    },
  },
  {
    key: "discovery" as Category,
    label: "Discovery",
    description: "Buyer looking for vendors",
    badgeStyle: {
      border: "1px solid #e9d5ff",
      color: "#7c3aed",
      background: "#faf5ff",
    },
  },
  {
    key: "commercial" as Category,
    label: "Commercial",
    description: "Buyer comparing options",
    badgeStyle: {
      border: "1px solid #fed7aa",
      color: "#f97316",
      background: "#fff7ed",
    },
  },
  {
    key: "transactional" as Category,
    label: "Transactional",
    description: "Buyer ready to purchase",
    badgeStyle: {
      border: "1px solid #bbf7d0",
      color: "#16a34a",
      background: "#f0fdf4",
    },
  },
];

function getPrescriptiveRecommendation(
  weakestKey: Category,
  overallScore: number,
  trustSignals?: TrustSignals,
  businessProfile?: { whatTheySell?: string; companyName?: string }
): string {
  if (overallScore > 85) {
    return "Strong visibility — monitor weekly and publish one new FAQ-schema article per month to maintain citation consistency.";
  }

  const sellsText = (businessProfile?.whatTheySell ?? "").toLowerCase();
  const isTrading = /trading|forex|crypto|stocks|invest|financ/.test(sellsText);
  const isHealthcare = /health|medical|clinic|therapy|wellness/.test(sellsText);
  const isSaaS = /software|saas|platform|app|tool|api/.test(sellsText);

  if (trustSignals) {
    if (!trustSignals.faqPage?.exists) {
      if (isTrading) return "Add a /faq page covering your trading platform, fees, and account types with FAQPage schema. Trading platform FAQs are heavily cited by AI when buyers compare platforms.";
      if (isHealthcare) return "Add a /faq page with FAQPage schema answering common patient questions. Healthcare FAQ pages are among the most cited content by AI in discovery queries.";
      if (isSaaS) return "Add a /faq page with FAQPage schema targeting your buyers' most common questions. FAQ schema is the #1 highest-impact fix for AI citation in software categories.";
      return "Add a /faq page with FAQPage schema. This is the single highest-impact fix for AI citation across all business types.";
    }
    if (!trustSignals.trustpilot?.exists && !trustSignals.g2?.exists && !trustSignals.capterra?.exists) {
      if (isTrading) return "Create a Trustpilot profile and actively collect customer reviews. Trading platforms with 100+ Trustpilot reviews are cited 4x more often by AI in comparison queries.";
      if (isSaaS) return "Claim your G2 and Capterra profiles and collect 10+ verified reviews. G2 pages appear in AI responses for nearly every software category.";
      return "Create a Trustpilot profile and collect 10+ customer reviews. AI engines use third-party review platforms to validate brand credibility before citing.";
    }
    if (!trustSignals.pressmentions?.exists) {
      if (isTrading) return "Get featured in fintech publications like Finextra, Finance Magnates, or FXStreet. Press coverage in niche publications is a strong entity signal for trading platforms.";
      return "Get 2-3 press mentions or guest articles in industry publications. Press coverage tells AI engines your brand is established and credible.";
    }
    if (!trustSignals.medium?.exists && !trustSignals.substack?.exists) {
      return "Publish 3 articles on Medium.com targeting your category keywords. Medium has very high domain authority and AI engines frequently cite it as a source.";
    }
    if (!trustSignals.redditMentions?.exists) {
      return "Seed 2-3 genuine Reddit posts or answers in relevant subreddits. Reddit content is heavily indexed by Perplexity and influences AI recommendations.";
    }
  }

  const intentAdvice: Record<Category, string> = {
    informational: "Create educational content answering the exact questions your buyers ask at the start of their research journey. Target these with FAQ schema markup.",
    discovery: "Get listed on directories and comparison sites where buyers in your category first discover vendors. Add structured data to help AI engines index your listings.",
    commercial: "Build comparison content addressing how your offering differs from alternatives. Buyers researching options need to find you during evaluation.",
    transactional: "Ensure your key service or product pages have clear structured data and prominent calls to action. Buyers ready to convert need to find the path forward.",
  };

  return intentAdvice[weakestKey] ?? intentAdvice.informational;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function scoreColor(score: number | null) {
  if (score === null) return "#777";
  if (score > 66) return "#16a34a";
  if (score >= 33) return "#f97316";
  return "#dc2626";
}

function scoreMessage(score: number | null) {
  if (score === null) return "Scan unavailable — no successful checks";
  if (score > 66) return "Strong AI visibility";
  if (score >= 33) return "Partial AI visibility";
  return "Nearly invisible in AI search";
}

function pct(cs: CategoryScore) {
  if (!cs || cs.total === 0) return 0;
  return Math.round((cs.appeared / cs.total) * 100);
}

// ── Sentiment ────────────────────────────────────────────────────────────────

const SENTIMENT_META = {
  positive: { label: "Positive", symbol: "✓", bg: "#dcfce7", color: "#16a34a" },
  neutral: { label: "Neutral", symbol: "", bg: "#f3f4f6", color: "#6b7280" },
  negative: { label: "Negative", symbol: "⚠", bg: "#fee2e2", color: "#dc2626" },
} as const;

function SentimentBadge({ sentiment }: { sentiment: "positive" | "neutral" | "negative" }) {
  const meta = SENTIMENT_META[sentiment];
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 8,
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "var(--font-mono, monospace)",
        background: meta.bg,
        color: meta.color,
        whiteSpace: "nowrap",
      }}
    >
      {meta.symbol ? `${meta.symbol} ${meta.label}` : meta.label}
    </span>
  );
}

function FactCheckBadge() {
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 8,
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "var(--font-mono, monospace)",
        background: "#ffedd5",
        color: "#c2410c",
        whiteSpace: "nowrap",
      }}
    >
      ⚠ Fact issue
    </span>
  );
}

function isValidEmail(email: string): boolean {
  const atIdx = email.indexOf("@");
  if (email.length < 5 || atIdx < 1) return false;
  return email.slice(atIdx + 1).includes(".");
}

// ── useCountUp ────────────────────────────────────────────────────────────────

function useCountUp(target: number, active: boolean, duration = 1500) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (!active) { setValue(0); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setValue(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, active, duration]);

  return value;
}

// ── EngineCard ────────────────────────────────────────────────────────────────

function EngineCard({
  label,
  engine,
  active,
  weight,
  error,
}: {
  label: string;
  engine: { score: number | null; available: boolean; successful?: number; attempted?: number } | undefined;
  active: boolean;
  weight?: number;
  error?: boolean;
}) {
  const display = useCountUp(engine?.score ?? 0, active && !!engine?.available && !error);
  return (
    <div
      style={{
        background: "#f7f7f5",
        border: "1px solid #e5e5e0",
        borderRadius: 6,
        padding: "20px 16px",
        textAlign: "center",
        transition: "border-color 150ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#d0d0c8")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e5e5e0")}
    >
      <p
        style={{
          fontFamily: "var(--font-sans, system-ui)",
          fontSize: 13,
          fontWeight: 500,
          color: "#555550",
          marginBottom: 2,
        }}
      >
        {label}
      </p>
      {weight !== undefined && (
        <p
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 10,
            color: "#aaa",
            marginBottom: 10,
            letterSpacing: "0.05em",
          }}
        >
          {weight}% weight
        </p>
      )}
      {engine?.available && engine.score !== null && !error ? (
        <>
          <p
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 30,
              fontWeight: 700,
              color: scoreColor(engine.score),
              lineHeight: 1,
            }}
          >
            {display}
            <span style={{ fontSize: 14, fontWeight: 400, color: "#999990" }}>%</span>
          </p>
          <p
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "#999990",
              fontFamily: "var(--font-mono, monospace)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            visibility{engine.successful !== undefined ? ` · ${engine.successful}/${engine.attempted} checks` : ""}
          </p>
        </>
      ) : error ? (
        <>
          <p
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 22,
              fontWeight: 700,
              color: "#999990",
              lineHeight: 1,
              marginBottom: 4,
            }}
          >
            N/A
          </p>
          <p
            style={{
              fontSize: 11,
              color: "#d0d0c8",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            key inactive
          </p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 20, opacity: 0.4, marginBottom: 4 }}>🔒</p>
          <p
            style={{
              fontSize: 11,
              color: "#999990",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            Add API key
          </p>
        </>
      )}
    </div>
  );
}

// ── Keyword types ─────────────────────────────────────────────────────────────

export interface KeywordItem {
  keyword: string;
  searchVolume: "High" | "Medium" | "Low" | "Not measured";
  llmPotential: "High" | "Medium" | "Low" | "Not assessed";
  why: string;
}

export interface KeywordsData {
  source?: "research" | "scan-prompts";
  tier1: KeywordItem[];
  tier2: KeywordItem[];
  tier3: KeywordItem[];
}

// ── KeywordCard ───────────────────────────────────────────────────────────────

function KeywordCard({ item, borderColor }: { item: KeywordItem; borderColor: string }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(item.keyword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const potentialColor =
    item.llmPotential === "High"
      ? { bg: "#f0fdf4", border: "#bbf7d0", text: "#16a34a" }
      : item.llmPotential === "Medium"
      ? { bg: "#fffbeb", border: "#fde68a", text: "#d97706" }
      : { bg: "#f7f7f5", border: "#e5e5e0", text: "#999990" };

  const volColor =
    item.searchVolume === "High"
      ? { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" }
      : item.searchVolume === "Medium"
      ? { bg: "#faf5ff", border: "#e9d5ff", text: "#7c3aed" }
      : { bg: "#f7f7f5", border: "#e5e5e0", text: "#999990" };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#ffffff",
        border: "1px solid #e5e5e0",
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 6,
        padding: "14px 16px",
        transition: "border-color 150ms ease",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <p
          style={{
            fontFamily: "var(--font-sans, system-ui)",
            fontWeight: 600,
            fontSize: 14,
            color: "#0a0a0a",
            lineHeight: 1.4,
            flex: 1,
          }}
        >
          {item.keyword}
        </p>
        {hovered && (
          <button
            onClick={handleCopy}
            style={{
              background: copied ? "#f0fdf4" : "#f7f7f5",
              border: `1px solid ${copied ? "#bbf7d0" : "#e5e5e0"}`,
              borderRadius: 4,
              padding: "3px 10px",
              fontSize: 11,
              fontFamily: "var(--font-mono, monospace)",
              color: copied ? "#16a34a" : "#555550",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono, monospace)",
            letterSpacing: "0.06em",
            padding: "2px 7px",
            borderRadius: 3,
            background: potentialColor.bg,
            border: `1px solid ${potentialColor.border}`,
            color: potentialColor.text,
          }}
        >
          AI estimate: {item.llmPotential}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono, monospace)",
            letterSpacing: "0.06em",
            padding: "2px 7px",
            borderRadius: 3,
            background: volColor.bg,
            border: `1px solid ${volColor.border}`,
            color: volColor.text,
          }}
        >
          Vol: {item.searchVolume}
        </span>
      </div>

      <p
        style={{
          marginTop: 8,
          fontFamily: "var(--font-sans, system-ui)",
          fontSize: 12,
          color: "#999990",
          lineHeight: 1.55,
        }}
      >
        {item.why}
      </p>
    </div>
  );
}

// ── KeywordsSection ───────────────────────────────────────────────────────────

function KeywordsSection({ keywordsData, keywordsLoading, emailCaptured }: { keywordsData: KeywordsData | null; keywordsLoading: boolean; emailCaptured?: boolean }) {
  const [activeTab, setActiveTab] = useState<"tier1" | "tier2" | "tier3">("tier1");

  const tabs = [
    { key: "tier1" as const, label: "High Intent", borderColor: "#f97316" },
    { key: "tier2" as const, label: "Mid Intent", borderColor: "#d97706" },
    { key: "tier3" as const, label: "Awareness", borderColor: "#d0d0c8" },
  ];

  const rawItems = keywordsData?.[activeTab] ?? [];
  const activeItems = emailCaptured ? rawItems : rawItems.slice(0, 3);
  const activeBorder = tabs.find((t) => t.key === activeTab)!.borderColor;

  return (
    <div style={{ marginTop: 48 }}>
      {/* Section header */}
      <div style={{ marginBottom: 20 }}>
        <p
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 10,
            color: "#999990",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Keywords
        </p>
        <h2
          style={{
            fontFamily: "var(--font-sans, system-ui)",
            fontWeight: 700,
            fontSize: 20,
            color: "#0a0a0a",
            letterSpacing: "-0.02em",
            marginBottom: 4,
          }}
        >
          Keywords to Target
        </h2>
        <p style={{ fontFamily: "var(--font-sans, system-ui)", fontSize: 13, color: "#555550" }}>
          {keywordsData?.source === "scan-prompts" ? KEYWORD_FALLBACK_NOTE : "Suggestions from search research. AI estimates are hypotheses; search volume and revenue impact have not been measured."}
        </p>
      </div>

      {/* Loading state */}
      {keywordsLoading && (
        <div
          style={{
            background: "#f7f7f5",
            border: "1px solid #e5e5e0",
            borderRadius: 8,
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid #e5e5e0",
                borderTopColor: "#f97316",
                display: "inline-block",
                animation: "sp-ring-spin 0.8s linear infinite",
              }}
            />
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, color: "#999990" }}>
              Generating keyword recommendations...
            </span>
          </div>
        </div>
      )}

      {/* Tabs + content */}
      {!keywordsLoading && keywordsData && (
        <>
          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 16,
              borderBottom: "1px solid #e5e5e0",
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  fontFamily: "var(--font-sans, system-ui)",
                  color: activeTab === tab.key ? "#0a0a0a" : "#999990",
                  cursor: "pointer",
                  borderBottom: activeTab === tab.key ? `2px solid ${tab.borderColor}` : "2px solid transparent",
                  marginBottom: -1,
                  transition: "color 150ms ease",
                }}
              >
                {tab.label}
                <span
                  style={{
                    marginLeft: 6,
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 11,
                    color: activeTab === tab.key ? tab.borderColor : "#d0d0c8",
                  }}
                >
                  {keywordsData[tab.key]?.length ?? 0}
                </span>
              </button>
            ))}
          </div>

          {/* Keyword cards */}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr" }}>
            {activeItems.map((item, i) => (
              <KeywordCard key={i} item={item} borderColor={activeBorder} />
            ))}
          </div>

          {/* Teaser overlay — visible until email submitted */}
          {!emailCaptured && (
            <div
              style={{
                textAlign: "center",
                padding: "16px",
                background: "rgba(245,241,234,0.9)",
                borderRadius: 8,
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a3a2e", marginBottom: 4 }}>
                Submit your email to see all keywords
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                Free — see all high, mid and awareness intent keywords for your category
              </div>
            </div>
          )}

          {/* Footer note — visible only after email submitted */}
          {emailCaptured && (
            <p
              style={{
                marginTop: 20,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
                color: "#999990",
                lineHeight: 1.7,
                textAlign: "center",
                padding: "16px 24px",
                background: "#f7f7f5",
                border: "1px solid #e5e5e0",
                borderRadius: 6,
              }}
            >
              Appearing for these keywords in ChatGPT, Gemini &amp; Perplexity drives inbound pipeline.{" "}
              <span style={{ color: "#1A3A2E" }}>Scanrr</span> tracks your visibility for each.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── PrintReport (hidden, shows only on print) ─────────────────────────────────

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  color: "#C8B89A",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  fontFamily: "monospace",
  fontWeight: 600,
  marginBottom: 12,
};

function PrintReport({
  scanData,
  keywordsData,
}: {
  scanData: ScanData;
  keywordsData: KeywordsData | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const scanDate = new Date(scanData.createdAt ?? Date.now()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const engineCites = ENGINES.map(({ key, label }) => {
    const cited = scanData.results?.filter((r) => r[key]?.appeared).length ?? 0;
    const total = scanData.engines?.[key]?.successful ?? scanData.results?.length ?? 0;
    const available = scanData.engines?.[key]?.available ?? false;
    return { key, label, cited, total, available, score: Math.round(scanData.engines?.[key]?.score ?? 0) };
  });

  // Insights — same logic as main component
  const printInsights = scanData.overallScore !== null && scanData.categoryScores
    ? (() => {
        const cats = CATEGORIES.map((c) => ({
          ...c,
          p: pct(scanData.categoryScores?.[c.key] ?? { appeared: 0, total: 0 }),
        }));
        const strongest = cats.reduce((a, b) => (a.p >= b.p ? a : b));
        const weakest = cats.reduce((a, b) => (a.p <= b.p ? a : b));
        return { strongest, weakest };
      })()
    : null;

  // Keywords grouped by tier
  const kwTiers = [
    { label: "High Intent", color: "#f97316", items: keywordsData?.tier1 ?? [] },
    { label: "Mid Intent", color: "#d97706", items: keywordsData?.tier2 ?? [] },
    { label: "Awareness", color: "#6b7280", items: keywordsData?.tier3 ?? [] },
  ].filter((t) => t.items.length > 0);

  if (!mounted) return null;

  return ReactDOM.createPortal(
    <div
      id="scanrr-print-report"
      aria-hidden="true"
      style={{ position: "absolute", left: "-9999px", top: 0, width: "210mm", pointerEvents: "none" }}
    >
      <div
        style={{
          background: "#F5F1EA",
          padding: "40px 48px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#0E1F18",
          fontSize: 11,
          maxWidth: 900,
          margin: "0 auto",
        }}
      >

        {/* ── 1. Header ────────────────────────────────────────────── */}
        <div
          style={{
            borderBottom: "2px solid #1A3A2E",
            paddingBottom: 16,
            marginBottom: 24,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div style={{ fontFamily: "Georgia, serif", fontWeight: 700, fontSize: 24, color: "#1A3A2E", letterSpacing: "-0.02em" }}>
              Scanrr
            </div>
            <div style={{ fontSize: 10, color: "#C8B89A", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 3, fontFamily: "monospace" }}>
              AI Visibility Report · by Sparrwo
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0E1F18" }}>
              {scanData.businessProfile?.companyName ?? ""}
            </div>
            <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace", marginTop: 3 }}>
              {scanDate}
            </div>
          </div>
        </div>

        {/* ── 2. Overall score ─────────────────────────────────────── */}
        <div
          style={{
            background: "#1A3A2E",
            borderRadius: 8,
            padding: "24px 32px",
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: 56, fontWeight: 800, color: "#C8B89A", fontFamily: "Georgia, serif", lineHeight: 1 }}>
              {scanData.overallScore ?? "—"}
            </div>
            <div style={{ fontSize: 10, color: "#C8B89A", opacity: 0.7, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "monospace", marginTop: 4 }}>
              / 100
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#C8B89A", opacity: 0.8, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 6 }}>
              AI Visibility Score
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#ffffff", fontFamily: "Georgia, serif", marginBottom: 6 }}>
              {scoreMessage(scanData.overallScore)}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
              {scanData.coverage ? `${scanData.coverage.successful}/${scanData.coverage.total} checks completed. Failed and unverified checks are excluded.` : "Historical report — check coverage was not recorded."}
            </div>
          </div>
        </div>

        {/* ── 3. ICP Profile ───────────────────────────────────────── */}
        {scanData.businessProfile && (
          <div style={{ marginBottom: 24, pageBreakInside: "avoid" }}>
            <div style={SECTION_LABEL_STYLE}>ICP Profile Detected</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Company", val: scanData.businessProfile.companyName },
                { label: "What they sell", val: scanData.businessProfile.whatTheySell },
                {
                  label: "Primary buyer",
                  val: `${scanData.icp?.primaryBuyer ?? ""}${scanData.icp?.buyerLocation && scanData.icp.buyerLocation !== "unknown" ? ` · ${scanData.icp.buyerLocation}` : ""}`,
                },
                { label: "Their pain", val: scanData.icp?.buyerPainPoint ?? "" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{ background: "#ffffff", border: "1px solid #D8D2C8", borderRadius: 6, padding: "10px 14px" }}
                >
                  <div style={{ fontSize: 9, color: "#999", fontFamily: "monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#0E1F18", lineHeight: 1.5 }}>{item.val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 4. Engine breakdown ──────────────────────────────────── */}
        <div style={{ marginBottom: 24, pageBreakInside: "avoid" }}>
          <div style={SECTION_LABEL_STYLE}>Engine Breakdown</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {engineCites.map(({ key, label, cited, total, available, score }) => (
              <div key={key} style={{ background: "#ffffff", border: "1px solid #D8D2C8", borderRadius: 6, padding: "12px 16px" }}>
                <div style={{ fontSize: 9, color: "#999", fontFamily: "monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
                  {label}
                </div>
                {available ? (
                  <>
                    <div style={{ fontSize: 26, fontWeight: 800, color: score > 0 ? "#1A3A2E" : "#dc2626", fontFamily: "Georgia, serif", lineHeight: 1, marginBottom: 4 }}>
                      {score}%
                    </div>
                    <div style={{ fontSize: 9, color: "#888", fontFamily: "monospace" }}>
                      {cited > 0 ? `cited ${cited}/${total}` : "not cited"}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>not connected</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── 5. Buyer prompts table ───────────────────────────────── */}
        {scanData.results && scanData.results.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL_STYLE}>Buyer Prompts — All {scanData.results.length} Results</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#1A3A2E" }}>
                  <th style={{ padding: "7px 10px", textAlign: "left", color: "#ffffff", fontFamily: "monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                    Prompt
                  </th>
                  {ENGINES.map(({ label }) => (
                    <th key={label} style={{ padding: "7px 8px", textAlign: "center", color: "#C8B89A", fontFamily: "monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((catMeta) => {
                  const catResults = (scanData.results ?? []).filter((r) => r.category === catMeta.key);
                  if (catResults.length === 0) return null;
                  const cs = scanData.categoryScores?.[catMeta.key] ?? { appeared: 0, total: 0 };
                  const catPct = pct(cs);
                  const appearedCount = catResults.filter((r) => r.gemini?.appeared || r.claude?.appeared || r.chatgpt?.appeared || r.perplexity?.appeared).length;
                  return (
                    <React.Fragment key={catMeta.key}>
                      {/* Category header row */}
                      <tr style={{ background: "#EAE4DA", pageBreakInside: "avoid" }}>
                        <td colSpan={5} style={{ padding: "6px 10px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ ...catMeta.badgeStyle, borderRadius: 3, padding: "1px 6px", fontSize: 9, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              {catMeta.label}
                            </span>
                            <span style={{ fontSize: 9, color: "#888", fontFamily: "monospace" }}>
                              {appearedCount}/{catResults.length} appeared ({catPct}%)
                            </span>
                          </div>
                        </td>
                      </tr>
                      {/* Prompt rows */}
                      {catResults.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#ffffff" : "#F5F1EA", borderBottom: "1px solid #E8E2D8", pageBreakInside: "avoid" }}>
                          <td style={{ padding: "6px 10px", fontSize: 10, color: "#555", lineHeight: 1.4 }}>
                            {row.prompt}
                          </td>
                          {ENGINES.map(({ key }) => {
                            const eng = scanData.engines?.[key];
                            const res = row[key as keyof Pick<PromptResult, "gemini" | "claude" | "chatgpt" | "perplexity">] as EngineResult | undefined;
                            return (
                              <td key={key} style={{ padding: "6px 8px", textAlign: "center" }}>
                                {!eng?.available || !res || (res.status !== undefined && res.status !== "success") ? (
                                  <span style={{ fontSize: 9, color: "#777" }}>{res?.status === "unverified" ? "Unverified" : "N/A"}</span>
                                ) : res?.appeared ? (
                                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#16a34a" }} />
                                ) : (
                                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#dc2626", opacity: 0.4 }} />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 6. Insights ──────────────────────────────────────────── */}
        {printInsights && scanData.overallScore !== null && (
          <div style={{ marginBottom: 24, pageBreakInside: "avoid" }}>
            <div style={SECTION_LABEL_STYLE}>Insights</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div style={{ background: "#ffffff", border: "1px solid #D8D2C8", borderRadius: 6, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, color: "#999", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Strongest Intent</div>
                <div style={{ fontWeight: 600, color: "#16a34a", fontSize: 13, marginBottom: 3 }}>{printInsights.strongest.label}</div>
                <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>{printInsights.strongest.p}% visibility</div>
              </div>
              <div style={{ background: "#ffffff", border: "1px solid #D8D2C8", borderRadius: 6, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, color: "#999", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Biggest Gap</div>
                <div style={{ fontWeight: 600, color: scanData.overallScore > 90 ? "#16a34a" : "#dc2626", fontSize: 13, marginBottom: 3 }}>
                  {scanData.overallScore > 90 ? "Maintaining strong visibility" : printInsights.weakest.label}
                </div>
                <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>
                  {scanData.overallScore > 90 ? "All intent stages well covered" : `${100 - printInsights.weakest.p}% gap — buyers can't find you`}
                </div>
              </div>
              <div style={{ background: "#ffffff", border: "1px solid #D8D2C8", borderRadius: 6, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, color: "#999", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Recommendation</div>
                <div style={{ fontSize: 11, color: "#555", lineHeight: 1.6 }}>{getPrescriptiveRecommendation(printInsights.weakest.key, scanData.overallScore, scanData.trustSignals, scanData.businessProfile)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── 7. Trust Signals checklist ──────────────────────────── */}
        {scanData.trustSignals && (() => {
          const ts = scanData.trustSignals!;
          const items = [
            scanData.businessType === 'physical'
              ? { name: "Product listings (IndiaMART or Amazon)", exists: !!(ts.indiamartListing?.exists || ts.marketplaceListing?.exists) }
              : { name: "Review profiles (Trustpilot, G2 or Capterra)", exists: !!(ts.trustpilot?.exists || ts.g2?.exists || ts.capterra?.exists) },
            { name: "FAQ page with schema", exists: !!ts.faqPage?.exists },
            { name: "Press mentions", exists: !!ts.pressmentions?.exists },
            { name: "Reddit presence", exists: !!ts.redditMentions?.exists },
            { name: "Medium or Substack content", exists: !!(ts.medium?.exists || ts.substack?.exists) },
            { name: "YouTube channel", exists: !!ts.youtube?.exists },
            { name: "LinkedIn company page", exists: !!ts.linkedinPage?.exists },
          ];
          return (
            <div className="print-section" style={{ marginBottom: 24, pageBreakInside: "avoid" }}>
              <div style={SECTION_LABEL_STYLE}>Trust Signals</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {items.map((item) => (
                  <div
                    key={item.name}
                    style={{
                      background: item.exists ? "#f0fdf4" : "#fff1f2",
                      border: `1px solid ${item.exists ? "#bbf7d0" : "#fecaca"}`,
                      borderLeft: `3px solid ${item.exists ? "#16a34a" : "#dc2626"}`,
                      borderRadius: 4,
                      padding: "6px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: item.exists ? "#16a34a" : "#dc2626", flexShrink: 0 }}>
                      {item.exists ? "✓" : "✗"}
                    </span>
                    <span style={{ fontSize: 10, color: "#0E1F18", lineHeight: 1.4 }}>{item.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── 8. Keywords to Target ────────────────────────────────── */}
        {kwTiers.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL_STYLE}>Keywords to Target</div>
            <p style={{ fontSize: 10, color: "#555550" }}>{keywordsData?.source === "scan-prompts" ? KEYWORD_FALLBACK_NOTE : "AI prioritization estimates, not measured search volume or revenue forecasts."}</p>
            {kwTiers.map((tier) => (
              <div key={tier.label} style={{ marginBottom: 16 }}>
                {/* Tier header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 3, height: 14, background: tier.color, borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#0E1F18", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {tier.label}
                  </span>
                  <span style={{ fontSize: 9, color: "#aaa", fontFamily: "monospace" }}>({tier.items.length})</span>
                </div>
                {/* Keyword rows */}
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {tier.items.map((k, i) => {
                      const potColor = k.llmPotential === "High" ? "#16a34a" : k.llmPotential === "Medium" ? "#d97706" : "#999";
                      const volColor = k.searchVolume === "High" ? "#2563eb" : k.searchVolume === "Medium" ? "#7c3aed" : "#999";
                      return (
                        <tr
                          key={i}
                          style={{ background: i % 2 === 0 ? "#ffffff" : "#F5F1EA", borderBottom: "1px solid #E8E2D8", pageBreakInside: "avoid" }}
                        >
                          <td style={{ padding: "6px 10px", fontWeight: 600, fontSize: 11, color: "#0E1F18", borderLeft: `2px solid ${tier.color}` }}>
                            {k.keyword}
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <span style={{ fontSize: 9, fontFamily: "monospace", color: potColor, background: potColor + "18", border: `1px solid ${potColor}40`, borderRadius: 3, padding: "1px 5px" }}>
                              AI estimate: {k.llmPotential}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <span style={{ fontSize: 9, fontFamily: "monospace", color: volColor, background: volColor + "18", border: `1px solid ${volColor}40`, borderRadius: 3, padding: "1px 5px" }}>
                              Vol: {k.searchVolume}
                            </span>
                          </td>
                          <td style={{ padding: "6px 10px", fontSize: 10, color: "#888", lineHeight: 1.4 }}>
                            {k.why}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* ── 9. Footer CTA ────────────────────────────────────────── */}
        <div className="print-section" style={{ background: "#1A3A2E", borderRadius: 8, padding: "20px 28px", textAlign: "center", pageBreakInside: "avoid" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff", fontFamily: "Georgia, serif", marginBottom: 6 }}>
            Want to improve this score?
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginBottom: 10 }}>
            Book a free 30-minute AI visibility strategy call.
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#C8B89A", letterSpacing: "0.06em" }}>
            calendly.com/boringmonkee/call · sparrwo.com
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
}

// ── TrustSignalsTeaser ───────────────────────────────────────────────────────

function TrustSignalsTeaser({
  trustSignals,
  emailCaptured,
  businessType,
}: {
  trustSignals: NonNullable<ScanData["trustSignals"]>;
  emailCaptured: boolean;
  businessType?: ScanData["businessType"];
}) {
  const isPhysical = businessType === 'physical';
  const signals = [
    {
      exists: isPhysical
        ? !!(trustSignals.indiamartListing?.exists || trustSignals.marketplaceListing?.exists)
        : !!(trustSignals.trustpilot?.exists || trustSignals.g2?.exists || trustSignals.capterra?.exists),
      name: isPhysical ? "Product listings" : "Review profiles",
      okNote: isPhysical
        ? "Found on IndiaMART or Amazon — marketplace presence helps AI cite you"
        : "Trustpilot, G2, or Capterra found — AI engines use review data to validate brand credibility",
      missingNote: isPhysical
        ? "Not listed on IndiaMART or Amazon — major gap for physical product discovery"
        : "No verified review profiles — a major trust gap for AI citation",
    },
    {
      exists: !!trustSignals.faqPage?.exists,
      name: "FAQ page",
      okNote: "FAQ page found — FAQPage schema is one of the strongest AI citation signals",
      missingNote: "Missing. FAQ schema is the #1 highest-impact fix for AI citation",
    },
    {
      exists: !!trustSignals.pressmentions?.exists,
      name: "Press mentions",
      okNote: "Press coverage found — AI engines cite brands mentioned in publications",
      missingNote: "No press coverage detected — AI engines have no external authority signals",
    },
    {
      exists: !!trustSignals.redditMentions?.exists,
      name: "Reddit presence",
      okNote: "Reddit discussions found — AI engines heavily cite Reddit for product research",
      missingNote: "Not mentioned on Reddit — AI engines frequently cite Reddit for vendor research",
    },
    {
      exists: !!(trustSignals.medium?.exists || trustSignals.substack?.exists),
      name: "Content on Medium / Substack",
      okNote: "Content found on high-DA platforms that AI engines frequently cite",
      missingNote: "No presence on Medium or Substack — easy wins for AI citation authority",
    },
    {
      exists: !!trustSignals.linkedinPage?.exists,
      name: "LinkedIn company page",
      okNote: "LinkedIn company page found — AI engines use LinkedIn to verify brand legitimacy",
      missingNote: "No LinkedIn company page detected — a credibility gap for B2B brands in AI search",
    },
  ];

  return (
    <div
      style={{
        marginTop: 24,
        background: "#F5F1EA",
        border: "1px solid #E8E0D0",
        borderRadius: 8,
        padding: 24,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10,
          color: "#999990",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        AI Trust Signals
      </p>
      <h2
        style={{
          fontFamily: "var(--font-sans, system-ui)",
          fontWeight: 700,
          fontSize: 20,
          color: "#0E1F18",
          letterSpacing: "-0.02em",
          marginBottom: 4,
        }}
      >
        What AI engines use to decide whether to cite you
      </h2>
      <p
        style={{
          fontFamily: "var(--font-sans, system-ui)",
          fontSize: 13,
          color: "#555550",
          marginBottom: 20,
        }}
      >
        These signals determine if AI engines trust your brand enough to recommend it.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {signals.map((signal, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              background: "#ffffff",
              border: `1px solid ${signal.exists ? "#bbf7d0" : "#fecaca"}`,
              borderLeft: `3px solid ${signal.exists ? "#16a34a" : "#dc2626"}`,
              borderRadius: 6,
              padding: "12px 16px",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
                marginTop: 2,
                color: signal.exists ? "#16a34a" : "#dc2626",
              }}
            >
              {signal.exists ? "✓" : "✗"}
            </span>
            <div>
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontWeight: 600,
                  fontSize: 13,
                  color: signal.exists ? "#15803d" : "#dc2626",
                  marginBottom: 2,
                }}
              >
                {signal.name}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 12,
                  color: "#555550",
                  lineHeight: 1.55,
                }}
              >
                {signal.exists ? signal.okNote : signal.missingNote}
              </p>
            </div>
          </div>
        ))}
      </div>

      {!emailCaptured && (
        <p
          style={{
            marginTop: 14,
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            color: "#999990",
            textAlign: "center",
            letterSpacing: "0.04em",
          }}
        >
          Unlock the full action plan below →
        </p>
      )}
    </div>
  );
}

// ── TrustSignalsActionPlan ────────────────────────────────────────────────────

function TrustSignalsActionPlan({
  trustSignals,
  businessProfile,
  businessType,
}: {
  trustSignals: NonNullable<ScanData["trustSignals"]>;
  businessProfile?: ScanData["businessProfile"];
  businessType?: ScanData["businessType"];
}) {
  const ts = trustSignals;
  const isPhysical = businessType === 'physical';
  const sellsText = (businessProfile?.whatTheySell ?? "").toLowerCase();
  const isSaaS = !isPhysical && /software|saas|platform|app|tool|api/.test(sellsText);

  const allSignals: {
    name: string;
    exists: boolean;
    detail: string | null;
    why: string;
    action: string;
    hidden?: boolean;
  }[] = [
    ...(isPhysical ? [
      {
        name: "IndiaMART listing",
        exists: !!ts.indiamartListing?.exists,
        detail: ts.indiamartListing?.exists ? ts.indiamartListing.url ?? "Listed" : null,
        why: "IndiaMART is one of India's most cited B2B marketplaces — AI engines reference it when buyers search for suppliers and products.",
        action: "List your products on IndiaMART at indiamart.com — a free basic listing takes under 30 minutes. AI engines frequently cite IndiaMART for product discovery queries.",
      },
      {
        name: "Amazon / Flipkart listing",
        exists: !!ts.marketplaceListing?.exists,
        detail: ts.marketplaceListing?.exists ? ts.marketplaceListing.url ?? "Listed" : null,
        why: "Amazon and Flipkart listings are high-authority sources AI engines cite when buyers search for where to buy a product.",
        action: "List your products on Amazon.in or Flipkart to build marketplace presence. These high-DA pages significantly improve AI citation for purchase-intent queries.",
      },
    ] : [
      {
        name: "Trustpilot reviews",
        exists: !!ts.trustpilot?.exists,
        detail: ts.trustpilot?.exists
          ? [
              ts.trustpilot.rating ? `${ts.trustpilot.rating}/5` : "",
              ts.trustpilot.count ? `${ts.trustpilot.count.toLocaleString()} reviews` : "",
            ].filter(Boolean).join(" · ") || "Profile found"
          : null,
        why: "AI engines use Trustpilot ratings to validate brand credibility in commercial and transactional queries.",
        action:
          "Create a free Trustpilot profile at trustpilot.com/signup — target 10 customer reviews in the next 30 days. AI engines weight review platforms heavily.",
      },
      {
        name: "G2 listing",
        exists: !!ts.g2?.exists,
        detail: ts.g2?.exists
          ? [
              ts.g2.rating ? `${ts.g2.rating}/5` : "",
              ts.g2.count ? `${ts.g2.count.toLocaleString()} reviews` : "",
            ].filter(Boolean).join(" · ") || "Listed"
          : null,
        why: "G2 is one of the most frequently cited review sources in AI responses for software and SaaS products.",
        action:
          "Claim your G2 profile and collect at least 5 verified reviews. G2 pages appear in AI responses for nearly every software category.",
        hidden: !isSaaS,
      },
      {
        name: "Capterra listing",
        exists: !!ts.capterra?.exists,
        detail: ts.capterra?.exists ? "Listed" : null,
        why: "Capterra reviews drive AI citations for software buying decisions.",
        action:
          "List your product on Capterra at capterra.com/vendors — free to get started. Capterra reviews are heavily weighted in transactional AI responses.",
        hidden: !isSaaS,
      },
    ]),
    {
      name: "FAQ page",
      exists: !!ts.faqPage?.exists,
      detail: ts.faqPage?.exists ? ts.faqPage.url ?? "Page found" : null,
      why: "FAQPage JSON-LD schema directly feeds AI knowledge bases — the highest-impact technical fix for AI citation.",
      action:
        "Add a /faq page with FAQPage JSON-LD schema markup. Write answers to the exact questions your buyers ask at each intent stage. This is the #1 fix for AI citation.",
    },
    {
      name: "Press mentions",
      exists: !!ts.pressmentions?.exists,
      detail: ts.pressmentions?.exists
        ? ts.pressmentions.sources?.length
          ? `Mentioned in: ${ts.pressmentions.sources.join(", ")}`
          : "Coverage found"
        : null,
      why: "Press coverage from third-party publications is a strong authority signal that AI engines use when deciding who to cite.",
      action:
        "Get featured in industry publications — pitch your story to relevant tech blogs, submit press releases, or contribute guest articles. Even one high-DA mention significantly improves AI citation.",
    },
    {
      name: "Reddit presence",
      exists: !!ts.redditMentions?.exists,
      detail: ts.redditMentions?.exists
        ? [
            ts.redditMentions.sentiment
              ? ts.redditMentions.sentiment.charAt(0).toUpperCase() + ts.redditMentions.sentiment.slice(1) + " sentiment"
              : "",
            ts.redditMentions.count ? `${ts.redditMentions.count} threads` : "",
          ].filter(Boolean).join(" · ") || "Mentioned"
        : null,
      why: "Reddit is one of the most heavily cited sources in AI responses — buyers research vendors there and AI summarizes those threads.",
      action:
        "Engage authentically in subreddits relevant to your industry. Answer questions, share expertise, and never spam. Organic Reddit mentions are extremely high-value AI citation signals.",
    },
    {
      name: "Medium articles",
      exists: !!ts.medium?.exists,
      detail: ts.medium?.exists ? "Content found" : null,
      why: "Medium has very high domain authority and AI engines frequently cite it for educational and category content.",
      action:
        "Publish 3 articles on medium.com targeting your category keywords. Focus on 'how to choose [category]', 'best practices for [problem]', and buyer education content.",
    },
    {
      name: "Substack newsletter",
      exists: !!ts.substack?.exists,
      detail: ts.substack?.exists ? "Newsletter found" : null,
      why: "Substack newsletters are increasingly cited by AI as authoritative, niche-specific sources.",
      action:
        "Start a Substack newsletter in your niche. Publish bi-weekly insights. Even a small subscriber base gives you a high-authority content footprint that AI engines index.",
    },
    {
      name: "YouTube presence",
      exists: !!ts.youtube?.exists,
      detail: ts.youtube?.exists
        ? ts.youtube.channelUrl ?? (ts.youtube.videoCount ? `${ts.youtube.videoCount} videos` : "Channel found")
        : null,
      why: "YouTube is increasingly cited in AI responses for product discovery, reviews, and tutorials.",
      action:
        "Create a YouTube channel and publish 3–5 short videos: a product demo, a customer testimonial, and a category explainer. YouTube content appears in AI responses for product evaluation queries.",
    },
    {
      name: "LinkedIn company page",
      exists: !!ts.linkedinPage?.exists,
      detail: ts.linkedinPage?.exists
        ? ts.linkedinPage.url ?? "Page found"
        : null,
      why: "AI engines use LinkedIn to verify that a brand is a real, active company. A missing or sparse LinkedIn page is a trust red flag.",
      action:
        "Create or complete your LinkedIn company page with a full description, logo, and regular posts. AI engines cross-reference LinkedIn as a legitimacy signal when deciding whether to cite a brand.",
    },
  ];

  const visibleSignals = allSignals.filter((s) => !s.hidden);
  const missing = visibleSignals.filter((s) => !s.exists);
  const found = visibleSignals.filter((s) => s.exists);

  if (missing.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 24,
        background: "#F5F1EA",
        border: "1px solid #E8E0D0",
        borderRadius: 8,
        padding: 24,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10,
          color: "#999990",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Trust Signal Action Plan
      </p>
      <h2
        style={{
          fontFamily: "var(--font-sans, system-ui)",
          fontWeight: 700,
          fontSize: 20,
          color: "#0E1F18",
          letterSpacing: "-0.02em",
          marginBottom: 4,
        }}
      >
        Fix these to improve your AI citation rate
      </h2>
      <p
        style={{
          fontFamily: "var(--font-sans, system-ui)",
          fontSize: 13,
          color: "#555550",
          marginBottom: 20,
        }}
      >
        {missing.length} of {allSignals.length} signals missing — each fix increases the chance AI engines cite you.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: found.length > 0 ? 24 : 0 }}>
        {missing.map((signal, i) => (
          <div
            key={i}
            style={{
              background: "#ffffff",
              border: "1px solid #fecaca",
              borderLeft: "3px solid #dc2626",
              borderRadius: 6,
              padding: "16px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ color: "#dc2626", fontSize: 14, fontWeight: 700 }}>✗</span>
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontWeight: 600,
                  fontSize: 14,
                  color: "#dc2626",
                }}
              >
                {signal.name}
              </p>
            </div>
            <p
              style={{
                fontFamily: "var(--font-sans, system-ui)",
                fontSize: 12,
                color: "#888880",
                marginBottom: 10,
                lineHeight: 1.55,
              }}
            >
              {signal.why}
            </p>
            <div
              style={{
                background: "#fff7ed",
                border: "1px solid #fed7aa",
                borderRadius: 4,
                padding: "10px 12px",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  color: "#f97316",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Fix it
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 12,
                  color: "#555550",
                  lineHeight: 1.6,
                }}
              >
                {signal.action}
              </p>
            </div>
          </div>
        ))}
      </div>

      {found.length > 0 && (
        <>
          <p
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 10,
              color: "#999990",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Already in place
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {found.map((signal, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "#ffffff",
                  border: "1px solid #bbf7d0",
                  borderLeft: "3px solid #16a34a",
                  borderRadius: 6,
                  padding: "10px 14px",
                }}
              >
                <span style={{ color: "#16a34a", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>✓</span>
                <div>
                  <span
                    style={{
                      fontFamily: "var(--font-sans, system-ui)",
                      fontWeight: 600,
                      fontSize: 13,
                      color: "#15803d",
                    }}
                  >
                    {signal.name}
                  </span>
                  {signal.detail && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 11,
                        color: "#999990",
                        marginLeft: 8,
                      }}
                    >
                      {signal.detail}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── ResultsSection ────────────────────────────────────────────────────────────

interface ResultsSectionProps {
  scanData: ScanData;
  scanHistory?: ScanHistoryEntry[];
  keywordsData: KeywordsData | null;
  keywordsLoading: boolean;
  emailCaptured: boolean;
  emailInput: string;
  emailFocused: boolean;
  emailSubmitting: boolean;
  showToast: boolean;
  onEmailChange: (val: string) => void;
  onEmailFocus: (focused: boolean) => void;
  onEmailSubmit: (e: React.FormEvent) => void;
  sectionRef: React.RefObject<HTMLDivElement | null>;
}

export function ResultsSection({
  scanData,
  scanHistory = [],
  keywordsData: suppliedKeywordsData,
  keywordsLoading,
  emailCaptured,
  emailInput,
  emailFocused,
  emailSubmitting,
  showToast,
  onEmailChange,
  onEmailFocus,
  onEmailSubmit,
  sectionRef,
}: ResultsSectionProps) {
  const keywordsData = suppliedKeywordsData ?? (keywordsLoading ? null : keywordsFromPrompts(scanData.results));
  const [emailError, setEmailError] = useState("");

  const insights = scanData.overallScore !== null && scanData.categoryScores
    ? (() => {
        const cats = CATEGORIES.map((c) => ({
          ...c,
          p: pct(scanData.categoryScores?.[c.key] ?? { appeared: 0, total: 0 }),
        }));
        const strongest = cats.reduce((a, b) => (a.p >= b.p ? a : b));
        const weakest = cats.reduce((a, b) => (a.p <= b.p ? a : b));
        return { strongest, weakest };
      })()
    : null;

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "scanrr-print-styles";
    style.textContent = `
      @media print {
        body > *:not(#scanrr-print-report) { display: none !important; }
        #scanrr-print-report {
          display: block !important;
          position: static !important;
          left: auto !important;
          top: auto !important;
          width: 100% !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        #scanrr-print-report * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        #scanrr-print-report tr { page-break-inside: avoid !important; break-inside: avoid !important; }
        #scanrr-print-report .print-section { page-break-inside: avoid !important; break-inside: avoid !important; }
        @page { margin: 0.4in; size: A4; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById("scanrr-print-styles")?.remove(); };
  }, []);

  function downloadPDF() {
    const prev = document.title;
    document.title = `Scanrr Report — ${scanData.businessProfile?.companyName ?? scanData.businessProfile?.whatTheySell ?? "scan"}`;
    window.print();
    document.title = prev;
  }

  return (
    <section
      ref={sectionRef}
      className="animate-fade-in-up"
      style={{
        background: "#ffffff",
        borderTop: "1px solid #e5e5e0",
        padding: "48px 16px 80px",
      }}
    >
      {/* Toast */}
      {showToast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up"
          style={{
            border: "1px solid #fed7aa",
            background: "#fff7ed",
            color: "#f97316",
            borderRadius: 6,
            padding: "12px 20px",
            fontSize: 13,
            fontFamily: "var(--font-mono, monospace)",
            whiteSpace: "nowrap",
          }}
        >
          Report unlocked! We&apos;ll send you weekly AI updates for this domain.
        </div>
      )}

      <div style={{ maxWidth: 896, margin: "0 auto" }}>

        {scanHistory.length >= 2 && <p className="text-sm text-slate-600">Historical scores may use different questions, coverage or scoring methods. They are not a controlled trend.</p>}
        {/* Score circle */}
        <div
          style={{
            padding: "48px 0 32px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <ScoreCircle score={scanData.overallScore} active={true} />
          {scanData.coverage && <p role="status" className="px-4 text-center text-sm text-slate-600">
            {scanData.coverage.successful}/{scanData.coverage.total} checks usable for scoring.
            {scanData.coverage.successful < scanData.coverage.total && ` ${scanData.coverage.total - scanData.coverage.successful} checks were unavailable, failed or unverified and are not counted as absences. This score is incomplete. A usable check does not necessarily mean your brand appeared.`}
          </p>}
          <p
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 10,
              color: "#999990",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            AI Visibility Score
          </p>
          <p
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontSize: 16,
              fontWeight: 600,
              color: scoreColor(scanData.overallScore),
            }}
          >
            {scoreMessage(scanData.overallScore)}
          </p>
          {scanData.promptQuality && (
            <p
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
                color:
                  scanData.promptQuality.indicator === "high"
                    ? "#16a34a"
                    : scanData.promptQuality.indicator === "medium"
                    ? "#f97316"
                    : "#dc2626",
                letterSpacing: "0.04em",
              }}
            >
              {scanData.promptQuality.indicator === "high"
                ? "Questions do not contain your brand name"
                : scanData.promptQuality.indicator === "medium"
                ? "Some questions contain your brand name"
                : "Many questions contain your brand name"}
            </p>
          )}
        </div>

        {/* ICP card */}
        {scanData.businessProfile && (
          <div
            style={{
              background: "#f7f7f5",
              border: "1px solid #e5e5e0",
              borderRadius: 6,
              padding: 24,
              marginBottom: 24,
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 10,
                color: "#999990",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              ICP Profile Detected
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Company", val: scanData.businessProfile.companyName },
                { label: "What they sell", val: scanData.businessProfile.whatTheySell },
                {
                  label: "Primary buyer",
                  val: `${scanData.icp?.primaryBuyer ?? ""}${
                    scanData.icp?.buyerLocation && scanData.icp.buyerLocation !== "unknown"
                      ? ` · ${scanData.icp.buyerLocation}`
                      : ""
                  }`,
                },
                { label: "Their pain", val: scanData.icp?.buyerPainPoint ?? "" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e5e0",
                    borderRadius: 6,
                    padding: "12px 16px",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 10,
                      color: "#999990",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    {item.label}
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-sans, system-ui)",
                      fontSize: 13,
                      color: "#0a0a0a",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.val}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Engine cards */}
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          style={{
            marginBottom: 32,
          }}
        >
          {ENGINES.map(({ key, label, weight }) => (
            <EngineCard key={key} label={label} engine={scanData.engines?.[key]} active={true} weight={weight} error={scanData.engineErrors?.[key]} />
          ))}
        </div>

        {scanData.comparisonCoverage && scanData.competitorResults && Object.keys(scanData.competitorResults).length > 0 &&
          <p className="mb-3 text-sm text-slate-600">Comparison uses {scanData.comparisonCoverage.successful}/{scanData.comparisonCoverage.total} checks completed for every brand, with identical weights. Its coverage may differ from the overall score.</p>}
        {/* Competitor share of voice — only shown when competitor scan data exists */}
        {scanData.competitorResults && Object.keys(scanData.competitorResults).length > 0 && (() => {
          const yourDomain = scanData.domain ?? scanData.businessProfile?.companyName ?? "your site";
          const yourScore = scanData.comparisonScore ?? null;
          if (yourScore === null) return <p className="mb-6 text-sm text-amber-800">Competitor comparison unavailable: no checks completed for every brand.</p>;
          const compEntries = Object.values(scanData.competitorResults).filter((c): c is typeof c & { score: number } => c.score !== null);
          const maxScore = Math.max(yourScore, ...compEntries.map((c) => c.score), 1);

          const bars = [
            { domain: yourDomain, score: yourScore, isYou: true },
            ...compEntries.map((c) => ({ domain: c.domain, score: c.score, isYou: false })),
          ];

          return (
            <div style={{ marginBottom: 32 }}>
              <p
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  color: "#999990",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Competitor visibility — same answers
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 12.5,
                  color: "#999990",
                  marginBottom: 16,
                }}
              >
                How often each brand appears on AI
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {bars.map((b) => {
                  const widthPct = Math.max(2, Math.round((b.score / maxScore) * 100));
                  const aheadOfYou = !b.isYou && b.score > yourScore;
                  const behindYou = !b.isYou && b.score < yourScore;
                  return (
                    <div key={b.domain} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span
                        style={{
                          width: 140,
                          flexShrink: 0,
                          fontSize: 12.5,
                          fontWeight: b.isYou ? 700 : 500,
                          color: b.isYou ? "#1A3A2E" : "#555550",
                          fontFamily: "var(--font-sans, system-ui)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={b.domain}
                      >
                        {b.domain}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 14,
                          background: "#f0f0ed",
                          borderRadius: 8,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${widthPct}%`,
                            height: "100%",
                            background: b.isYou ? "#1A3A2E" : "#9BA8A0",
                            borderRadius: 8,
                            transition: "width 400ms ease",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          width: 38,
                          flexShrink: 0,
                          textAlign: "right",
                          fontSize: 12.5,
                          fontWeight: 600,
                          fontFamily: "var(--font-mono, monospace)",
                          color: "#0a0a0a",
                        }}
                      >
                        {b.score}%
                      </span>
                      {aheadOfYou && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", whiteSpace: "nowrap" }}>
                          ▲ ahead
                        </span>
                      )}
                      {behindYou && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#16a34a", whiteSpace: "nowrap" }}>
                          ✓ behind
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Fact check — only shown once at least one prompt was cited */}
        {scanData.factCheckSummary && scanData.factCheckSummary.totalCited > 0 && (() => {
          const fc = scanData.factCheckSummary!;
          const brand = scanData.businessProfile?.companyName ?? "your brand";

          if (fc.accurate === null || fc.checked === undefined) {
            return <p className="mb-6 rounded border border-amber-200 p-4 text-sm text-amber-800">Description checks incomplete: {fc.checked ?? 0}/{fc.totalCited} mentions checked. Accuracy has not been established.</p>;
          }
          if (fc.accurate === true) {
            return (
              <div
                style={{
                  marginBottom: 24,
                  padding: "14px 18px",
                  borderRadius: 6,
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 15, color: "#16a34a" }}>✓</span>
                <span style={{ fontSize: 13, color: "#166534", fontFamily: "var(--font-sans, system-ui)" }}>
                  No description inconsistencies found in {fc.checked}/{fc.totalCited} checked mentions of {brand}. This is an AI assessment, not independent fact verification.
                </span>
              </div>
            );
          }

          return (
            <div
              style={{
                marginBottom: 24,
                padding: "14px 18px",
                borderRadius: 6,
                background: "#fffbeb",
                border: "1px solid #fde68a",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: fc.issues.length > 0 ? 10 : 0 }}>
                <span style={{ fontSize: 15, color: "#d97706" }}>⚠</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#92400e", fontFamily: "var(--font-sans, system-ui)" }}>
                  Possible description inconsistencies for {brand} ({fc.checked}/{fc.totalCited} mentions checked)
                </span>
              </div>
              {fc.issues.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 26, display: "flex", flexDirection: "column", gap: 4 }}>
                  {fc.issues.map((issue, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: "#92400e", fontFamily: "var(--font-sans, system-ui)" }}>
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()}

        {/* Content recommendations — only shown when the backend generated some */}
        {scanData.contentRecommendations && scanData.contentRecommendations.length > 0 && (() => {
          const PRIORITY_META = {
            high: { label: "High Priority", color: "#dc2626" },
            medium: { label: "Medium Priority", color: "#d97706" },
            low: { label: "Low Priority", color: "#9ca3af" },
          } as const;

          const grouped: Record<"high" | "medium" | "low", typeof scanData.contentRecommendations> = {
            high: [],
            medium: [],
            low: [],
          };
          for (const rec of scanData.contentRecommendations) grouped[rec.priority]?.push(rec);

          return (
            <div style={{ marginBottom: 32 }}>
              <p
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  color: "#999990",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Content Recommendations
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 12.5,
                  color: "#999990",
                  marginBottom: 16,
                }}
              >
                What to build to get cited by AI engines
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {(["high", "medium", "low"] as const).map((priority) => {
                  const items = grouped[priority];
                  if (!items || items.length === 0) return null;
                  const meta = PRIORITY_META[priority];
                  return (
                    <div key={priority}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "#555550",
                            fontFamily: "var(--font-mono, monospace)",
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {items.map((rec, i) => (
                          <div
                            key={i}
                            style={{
                              borderLeft: `3px solid ${meta.color}`,
                              background: "#f7f7f5",
                              borderRadius: 6,
                              padding: "14px 16px",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: meta.color,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                fontFamily: "var(--font-mono, monospace)",
                                marginBottom: 6,
                              }}
                            >
                              {rec.type}
                            </div>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#0a0a0a",
                                marginBottom: 6,
                                fontFamily: "var(--font-sans, system-ui)",
                              }}
                            >
                              {rec.title}
                            </div>
                            <div
                              style={{
                                fontSize: 12.5,
                                color: "#555550",
                                lineHeight: 1.5,
                                marginBottom: 8,
                                fontFamily: "var(--font-sans, system-ui)",
                              }}
                            >
                              {rec.description}
                            </div>
                            <div style={{ fontSize: 11.5, color: "#999990", fontFamily: "var(--font-sans, system-ui)" }}>
                              <strong style={{ color: "#555550" }}>Expected impact:</strong> {rec.expectedImpact}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Sentiment breakdown — only shown once at least one prompt was cited */}
        {(() => {
          const results = scanData.results ?? [];
          const counts = { positive: 0, neutral: 0, negative: 0 };
          for (const r of results) {
            if (r.sentiment) counts[r.sentiment]++;
          }
          const citedCount = counts.positive + counts.neutral + counts.negative;
          if (citedCount === 0) return null;

          const brand = scanData.businessProfile?.companyName ?? "your brand";
          const SUMMARY_SYMBOLS = { positive: "●", neutral: "○", negative: "⚠" } as const;

          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 24,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  color: "#999990",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                AI mentions of {brand}:
              </span>
              {(["positive", "neutral", "negative"] as const).map((sentiment) => {
                const meta = SENTIMENT_META[sentiment];
                return (
                  <span
                    key={sentiment}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 20,
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      background: meta.bg,
                      color: meta.color,
                    }}
                  >
                    {SUMMARY_SYMBOLS[sentiment]} {counts[sentiment]} {meta.label}
                  </span>
                );
              })}
            </div>
          );
        })()}

        {/* Results table */}
        <div
          style={{
            border: "1px solid #e5e5e0",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 480,
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid #e5e5e0",
                    background: "#f7f7f5",
                  }}
                >
                  <th
                    style={{
                      padding: "12px 20px",
                      textAlign: "left",
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: 500,
                      fontSize: 10,
                      color: "#999990",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    Buyer Prompt
                  </th>
                  {ENGINES.map(({ key, label }) => (
                    <th
                      key={key}
                      className="hidden sm:table-cell"
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 500,
                        fontSize: 10,
                        color: "#999990",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const FREE_ROWS = 8;
                  let rowCount = 0;
                  const allResults = scanData?.results ?? [];
                  const elements: React.ReactNode[] = [];

                  for (const catMeta of CATEGORIES) {
                    const catResults = allResults.filter((r) => r.category === catMeta.key);
                    if (catResults.length === 0) continue;

                    const cs = scanData.categoryScores?.[catMeta.key] ?? { appeared: 0, total: 0 };
                    const catPct = pct(cs);
                    const appearedCount = catResults.filter(
                      (r) =>
                        r.gemini?.appeared ||
                        r.claude?.appeared ||
                        r.chatgpt?.appeared ||
                        r.perplexity?.appeared
                    ).length;

                    if (emailCaptured || rowCount < FREE_ROWS) {
                      elements.push(
                        <tr key={`h-${catMeta.key}`}>
                          <td
                            colSpan={ENGINES.length + 1}
                            style={{
                              borderBottom: "1px solid #e5e5e0",
                              background: "#ffffff",
                            }}
                          >
                            <div
                              style={{
                                padding: "10px 20px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <span
                                  style={{
                                    ...catMeta.badgeStyle,
                                    borderRadius: 4,
                                    padding: "2px 8px",
                                    fontSize: 10,
                                    fontFamily: "var(--font-mono, monospace)",
                                    fontWeight: 600,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  {catMeta.label}
                                </span>
                                <span
                                  className="hidden sm:inline"
                                  style={{
                                    fontSize: 12,
                                    color: "#999990",
                                    fontFamily: "var(--font-sans, system-ui)",
                                  }}
                                >
                                  {catMeta.description}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#999990",
                                  fontFamily: "var(--font-mono, monospace)",
                                }}
                              >
                                {appearedCount}/{catResults.length} appeared{" "}
                                <span style={{ color: scoreColor(catPct), fontWeight: 600 }}>
                                  ({catPct}%)
                                </span>
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    for (let i = 0; i < catResults.length; i++) {
                      const row = catResults[i];
                      const visible = emailCaptured || rowCount < FREE_ROWS;

                      if (visible) {
                        const rowBg = rowCount % 2 === 0 ? "#ffffff" : "#f7f7f5";
                        elements.push(
                          <tr
                            key={`r-${catMeta.key}-${i}`}
                            style={{
                              borderBottom: "1px solid #e5e5e0",
                              background: rowBg,
                              transition: "background 150ms ease",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.background = "#f0f0ed")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.background = rowBg)
                            }
                          >
                            <td
                              style={{
                                padding: "16px 20px",
                                fontSize: 13,
                                color: "#555550",
                                lineHeight: 1.55,
                                fontFamily: "var(--font-sans, system-ui)",
                              }}
                            >
                              {row.prompt}
                              {row.sentiment && <SentimentBadge sentiment={row.sentiment} />}
                              {[row.gemini, row.claude, row.chatgpt, row.perplexity].some(
                                (e) => e?.appeared && e?.factCheck?.accurate === false
                              ) && <FactCheckBadge />}
                            </td>
                            {ENGINES.map(({ key, label }) => {
                              const eng = scanData.engines?.[key];
                              const res = row[
                                key as keyof Pick<
                                  PromptResult,
                                  "gemini" | "claude" | "chatgpt" | "perplexity"
                                >
                              ] as EngineResult | undefined;
                              return (
                                <td
                                  key={key}
                                  className="hidden sm:table-cell"
                                  style={{
                                    padding: "16px",
                                    textAlign: "center",
                                    verticalAlign: "middle",
                                  }}
                                >
                                  {!eng?.available || !res || (res.status !== undefined && res.status !== "success") ? (
                                    <span title={res?.status ?? "Unavailable"} className="text-xs text-slate-500">{res?.status === "unverified" ? "Unverified" : "N/A"}</span>
                                  ) : res?.appeared ? (
                                    <span
                                      title={res.snippet || "Appeared"}
                                      style={{
                                        display: "inline-block",
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        background: "#16a34a",
                                      }}
                                    />
                                  ) : (
                                    <span
                                      style={{
                                        display: "inline-block",
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        background: "#dc2626",
                                        opacity: 0.5,
                                      }}
                                    />
                                  )}
                                  <span
                                    className="sm:hidden block"
                                    style={{
                                      fontSize: 9,
                                      color: "#999990",
                                      fontFamily: "var(--font-mono, monospace)",
                                      textTransform: "uppercase",
                                      marginTop: 4,
                                    }}
                                  >
                                    {label}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      }

                      rowCount++;

                    }
                  }

                  return elements;
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trust Signals teaser — always visible */}
        {scanData.trustSignals && (
          <TrustSignalsTeaser trustSignals={scanData.trustSignals} emailCaptured={emailCaptured} businessType={scanData.businessType} />
        )}

        {/* Standalone email gate — always visible until email captured */}
        {!emailCaptured && (
          <div
            style={{
              marginTop: 24,
              borderRadius: 8,
              padding: "48px 32px",
              textAlign: "center",
              background: "#0a0a0a",
            }}
          >
            {/* Lock icon */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                border: "1px solid rgba(26,58,46,0.3)",
                background: "rgba(26,58,46,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1A3A2E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>

            <h3
              style={{
                fontFamily: "var(--font-sans, system-ui)",
                fontWeight: 700,
                fontSize: 20,
                color: "#ffffff",
                marginBottom: 8,
              }}
            >
              Your full AI visibility report is ready
            </h3>
            <p
              style={{
                fontFamily: "var(--font-sans, system-ui)",
                fontSize: 14,
                color: "#888888",
                maxWidth: 400,
                margin: "0 auto 28px",
                lineHeight: 1.6,
              }}
            >
              See all 24 prompts, keyword recommendations, and your biggest gaps — free.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isValidEmail(emailInput.trim())) {
                  setEmailError("Please enter a valid email address");
                  return;
                }
                setEmailError("");
                onEmailSubmit(e);
              }}
              style={{ maxWidth: 360, margin: "0 auto" }}
            >
              <div style={{ position: "relative", marginBottom: 8 }}>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => {
                    onEmailChange(e.target.value);
                    if (emailError) setEmailError("");
                  }}
                  onFocus={() => onEmailFocus(true)}
                  onBlur={() => onEmailFocus(false)}
                  placeholder=" "
                  style={{
                    width: "100%",
                    background: "#1a1a1a",
                    border: `1px solid ${emailFocused ? "#1A3A2E" : "#2a2a2a"}`,
                    borderRadius: 6,
                    padding: emailInput || emailFocused ? "22px 16px 8px" : "14px 16px",
                    fontSize: 14,
                    color: "#ffffff",
                    outline: "none",
                    fontFamily: "var(--font-sans, system-ui)",
                    transition: "border-color 150ms ease, padding 150ms ease",
                    boxSizing: "border-box",
                  }}
                />
                <label
                  style={{
                    position: "absolute",
                    left: 16,
                    top: emailInput || emailFocused ? 7 : "50%",
                    transform: emailInput || emailFocused ? "none" : "translateY(-50%)",
                    fontSize: emailInput || emailFocused ? 10 : 14,
                    color: emailFocused ? "#1A3A2E" : "#666660",
                    pointerEvents: "none",
                    transition: "all 150ms ease",
                    fontFamily: "var(--font-sans, system-ui)",
                  }}
                >
                  Work email
                </label>
              </div>
              {emailError && (
                <p
                  style={{
                    fontSize: 12,
                    color: "#dc2626",
                    textAlign: "left",
                    marginBottom: 8,
                  }}
                >
                  {emailError}
                </p>
              )}
              <button
                type="submit"
                disabled={emailSubmitting}
                style={{
                  width: "100%",
                  background: "#1A3A2E",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "13px",
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "var(--font-sans, system-ui)",
                  cursor: emailSubmitting ? "not-allowed" : "pointer",
                  transition: "background 150ms ease",
                  opacity: emailSubmitting ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!emailSubmitting) e.currentTarget.style.background = "#243F33";
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#1A3A2E")}
              >
                {emailSubmitting ? "Unlocking..." : "Get My Full Report →"}
              </button>
            </form>
            <p
              style={{
                marginTop: 12,
                fontSize: 11,
                color: "#444444",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              No spam. Unsubscribe anytime.
            </p>
          </div>
        )}

        {/* Insights */}
        {insights && emailCaptured && scanData.overallScore !== null && (
          <div
            style={{
              marginTop: 24,
              background: "#f7f7f5",
              border: "1px solid #e5e5e0",
              borderRadius: 6,
              padding: 24,
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 10,
                color: "#999990",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 20,
              }}
            >
              Insights
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e5e5e0",
                  borderRadius: 6,
                  padding: 16,
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 10,
                    color: "#999990",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 6,
                  }}
                >
                  Strongest intent
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-sans, system-ui)",
                    fontWeight: 600,
                    color: "#16a34a",
                    marginBottom: 4,
                  }}
                >
                  {insights.strongest.label}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: "#999990",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {insights.strongest.p}% visibility
                </p>
              </div>
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e5e5e0",
                  borderRadius: 6,
                  padding: 16,
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 10,
                    color: "#999990",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 6,
                  }}
                >
                  Biggest gap
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-sans, system-ui)",
                    fontWeight: 600,
                    color: scanData.overallScore > 90 ? "#16a34a" : "#dc2626",
                    marginBottom: 4,
                  }}
                >
                  {scanData.overallScore > 90 ? "Maintaining strong visibility" : insights.weakest.label}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: "#999990",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {scanData.overallScore > 90
                    ? "All intent stages well covered"
                    : `${100 - insights.weakest.p}% gap — buyers can't find you`}
                </p>
              </div>
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e5e5e0",
                  borderRadius: 6,
                  padding: 16,
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 10,
                    color: "#999990",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 6,
                  }}
                >
                  Recommendation
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-sans, system-ui)",
                    fontSize: 13,
                    color: "#555550",
                    lineHeight: 1.6,
                  }}
                >
                  {getPrescriptiveRecommendation(insights.weakest.key, scanData.overallScore, scanData.trustSignals, scanData.businessProfile)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Trust Signals full action plan — email required */}
        {emailCaptured && scanData.trustSignals && (
          <TrustSignalsActionPlan trustSignals={scanData.trustSignals} businessProfile={scanData.businessProfile} businessType={scanData.businessType} />
        )}

        {/* Keywords section — teaser (3 visible) until email submitted */}
        <KeywordsSection keywordsData={keywordsData} keywordsLoading={keywordsLoading} emailCaptured={emailCaptured} />

        {/* Scan history — only shown once there are 2+ past scans for this domain */}
        {scanHistory.length >= 2 && (
          <div style={{ marginTop: 32 }}>
            <p
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 10,
                color: "#999990",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 12,
              }}
            >
              Scan History
            </p>
            <div
              style={{
                border: "1px solid #e5e5e0",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 480,
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e5e0", background: "#f7f7f5" }}>
                      {["Date", "Overall Score", "Gemini", "Claude", "ChatGPT", "Perplexity"].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "10px 16px",
                            textAlign: h === "Date" ? "left" : "center",
                            fontFamily: "var(--font-mono, monospace)",
                            fontWeight: 500,
                            fontSize: 10,
                            color: "#999990",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scanHistory.map((entry, i) => {
                      const isCurrent = i === 0;
                      const prev = scanHistory[i + 1];
                      const trend: "up" | "down" | "same" | null =
                        !prev ? null : entry.score > prev.score ? "up" : entry.score < prev.score ? "down" : "same";

                      return (
                        <tr
                          key={entry.created_at}
                          style={{
                            borderBottom: "1px solid #e5e5e0",
                            background: isCurrent ? "#1A3A2E" : i % 2 === 0 ? "#ffffff" : "#f7f7f5",
                            color: isCurrent ? "#F5F1EA" : "#0a0a0a",
                          }}
                        >
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: 12.5,
                              fontFamily: "var(--font-sans, system-ui)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {new Date(entry.created_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                            {isCurrent && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 9,
                                  fontFamily: "var(--font-mono, monospace)",
                                  color: "#C8B89A",
                                  letterSpacing: "0.06em",
                                  textTransform: "uppercase",
                                }}
                              >
                                Current
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
                            {entry.score}%{" "}
                            {trend === "up" && <span style={{ color: isCurrent ? "#4ade80" : "#16a34a" }}>▲</span>}
                            {trend === "down" && <span style={{ color: "#dc2626" }}>▼</span>}
                            {trend === "same" && <span style={{ color: isCurrent ? "#C8B89A" : "#9ca3af" }}>→</span>}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "var(--font-mono, monospace)" }}>
                            {entry.gemini_score ?? "—"}{entry.gemini_score !== null ? "%" : ""}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "var(--font-mono, monospace)" }}>
                            {entry.claude_score ?? "—"}{entry.claude_score !== null ? "%" : ""}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "var(--font-mono, monospace)" }}>
                            {entry.chatgpt_score ?? "—"}{entry.chatgpt_score !== null ? "%" : ""}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "var(--font-mono, monospace)" }}>
                            {entry.perplexity_score ?? "—"}{entry.perplexity_score !== null ? "%" : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons — visible only after email capture */}
        {emailCaptured && (
          <div
            style={{
              marginTop: 24,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={downloadPDF}
              style={{
                background: "#1A3A2E",
                color: "#F5F1EA",
                border: "none",
                borderRadius: 6,
                padding: "11px 22px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-sans, system-ui)",
                cursor: "pointer",
                transition: "background 150ms ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#243F33")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#1A3A2E")}
            >
              Download PDF Report →
            </button>
            <a
              href="https://calendly.com/boringmonkee/call"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: "transparent",
                color: "#1A3A2E",
                border: "1px solid #1A3A2E",
                borderRadius: 6,
                padding: "11px 22px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-sans, system-ui)",
                cursor: "pointer",
                transition: "background 150ms ease, color 150ms ease",
                whiteSpace: "nowrap",
                textDecoration: "none",
                display: "inline-block",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#1A3A2E";
                e.currentTarget.style.color = "#F5F1EA";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#1A3A2E";
              }}
            >
              Book a Strategy Call →
            </a>
          </div>
        )}

        {/* Bottom CTA — hidden, can be re-enabled later */}
        <div style={{ display: "none" }}>
        <div
          style={{
            marginTop: 24,
            background: "#f7f7f5",
            border: "1px solid #e5e5e0",
            borderRadius: 6,
            padding: "40px 32px",
            textAlign: "center",
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontWeight: 700,
              fontSize: 20,
              color: "#0a0a0a",
              marginBottom: 8,
            }}
          >
            Want to monitor this daily?
          </h3>
          <p
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontSize: 14,
              color: "#555550",
              maxWidth: 480,
              margin: "0 auto 28px",
              lineHeight: 1.65,
            }}
          >
            Get weekly AI visibility reports, track competitors, and know when your brand
            disappears from AI search — before it costs you pipeline.
          </p>
          <button
            style={{
              background: "#1A3A2E",
              color: "#ffffff",
              border: "none",
              borderRadius: 6,
              padding: "13px 32px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-sans, system-ui)",
              cursor: "pointer",
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#243F33")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1A3A2E")}
          >
            Get Weekly Reports — $49/mo
          </button>
          <p
            style={{
              marginTop: 12,
              fontSize: 11,
              color: "#999990",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            Cancel anytime. 7-day free trial included.
          </p>
        </div>
        </div>{/* end display:none wrapper */}
      </div>

      <PrintReport scanData={scanData} keywordsData={keywordsData} />
    </section>
  );
}
