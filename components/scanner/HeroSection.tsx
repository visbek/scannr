"use client";

import { type ScanStatus } from "@/components/scanner/types";

interface HeroSectionProps {
  domain: string;
  status: ScanStatus;
  onDomainChange: (value: string) => void;
  onScan: (domain: string) => void;
}

export function HeroSection({ domain, status, onDomainChange, onScan }: HeroSectionProps) {
  const isLoading = status === "generating" || status === "scanning";
  const isIdle = status === "idle" || status === "error";

  return (
    <section
      style={{
        background: "#F5F1EA",
        borderBottom: isIdle ? "none" : "1px solid #D8D2C8",
      }}
      className={
        isIdle
          ? "flex min-h-[calc(100vh-57px)] flex-col items-center justify-center px-4 sm:px-6 py-16"
          : "px-4 sm:px-6 py-10"
      }
    >
      <div className={`w-full mx-auto ${isIdle ? "max-w-2xl text-center" : "max-w-2xl"}`}>

        {/* Full hero — idle only */}
        {isIdle && (
          <>
            {/* Eyebrow */}
            <p
              className="animate-fade-in-up"
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
                color: "#999990",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                marginBottom: 28,
              }}
            >
              AI Search Intelligence
            </p>

            {/* Headline — Barlow */}
            <h1
              className="animate-fade-in-up"
              style={{
                fontFamily: "var(--font-heading, sans-serif)",
                fontWeight: 800,
                fontSize: "clamp(40px, 6vw, 68px)",
                lineHeight: 1.05,
                letterSpacing: "-0.01em",
                color: "#0E1F18",
                marginBottom: 24,
                animationDelay: "0.08s",
              }}
            >
              Know where your brand lives in AI search.
            </h1>

            {/* Subheadline */}
            <p
              className="animate-fade-in-up"
              style={{
                fontFamily: "var(--font-sans, system-ui)",
                fontSize: 18,
                color: "#555550",
                lineHeight: 1.6,
                marginBottom: 40,
                animationDelay: "0.16s",
              }}
            >
              Scanrr scans ChatGPT, Gemini, Claude &amp; Perplexity to show
              exactly where buyers find — or miss — your brand.
            </p>
          </>
        )}

        {/* Input row */}
        <div
          className="animate-fade-in-up"
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 8,
            animationDelay: isIdle ? "0.22s" : "0s",
          }}
        >
          <input
            type="text"
            value={domain}
            onChange={(e) => onDomainChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isLoading && onScan(domain)}
            placeholder="yourdomain.com"
            disabled={isLoading}
            style={{
              flex: 1,
              background: "#f7f7f5",
              border: "1px solid #e5e5e0",
              borderRadius: 6,
              padding: "11px 16px",
              fontSize: 14,
              color: "#0a0a0a",
              outline: "none",
              minWidth: 0,
              transition: "border-color 150ms ease",
              fontFamily: "var(--font-sans, system-ui)",
              opacity: isLoading ? 0.5 : 1,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#0a0a0a")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e0")}
          />
          <button
            onClick={() => onScan(domain)}
            disabled={isLoading || !domain.trim()}
            style={{
              background: isLoading ? "#f0f0ed" : "#1A3A2E",
              color: isLoading ? "#999990" : "#ffffff",
              border: "none",
              borderRadius: 6,
              padding: "11px 20px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-sans, system-ui)",
              cursor: isLoading || !domain.trim() ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "background 150ms ease",
              opacity: !domain.trim() && !isLoading ? 0.5 : 1,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isLoading && domain.trim()) e.currentTarget.style.background = "#243F33";
            }}
            onMouseLeave={(e) => {
              if (!isLoading) e.currentTarget.style.background = "#1A3A2E";
            }}
          >
            {isLoading ? (
              <>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: "2px solid #d0d0c8",
                    borderTopColor: "#1A3A2E",
                    display: "inline-block",
                    animation: "sp-ring-spin 0.8s linear infinite",
                    flexShrink: 0,
                  }}
                />
                {status === "generating" ? "Analyzing..." : "Scanning..."}
              </>
            ) : (
              "Check My Visibility"
            )}
          </button>
        </div>

        {status === "error" && (
          <p style={{ marginTop: 12, fontSize: 13, color: "#dc2626", textAlign: "center" }}>
            Something went wrong. Please try again.
          </p>
        )}

        {/* Feature pills — idle only */}
        {isIdle && (
          <div
            className="animate-fade-in-up"
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              flexWrap: "wrap",
              animationDelay: "0.30s",
            }}
          >
            {["4 AI engines", "24 buyer prompts", "Free scan"].map((pill) => (
              <span
                key={pill}
                style={{
                  border: "1px solid #e5e5e0",
                  background: "#f7f7f5",
                  color: "#555550",
                  borderRadius: 4,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {pill}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Marketing sections — idle only */}
      {isIdle && (
        <div style={{ width: "100%", marginTop: 96 }}>

          {/* Value prop bar */}
          <div
            style={{
              borderTop: "1px solid #e5e5e0",
              borderBottom: "1px solid #e5e5e0",
              padding: "20px 24px",
              background: "#f7f7f5",
            }}
          >
            <div className="mx-auto max-w-6xl flex justify-center">
              <p
                style={{
                  fontSize: 13,
                  color: "#999990",
                  fontFamily: "var(--font-mono, monospace)",
                  letterSpacing: "0.04em",
                }}
              >
                Free scan{" "}
                <span style={{ color: "#d0d0c8" }}>·</span>
                {" "}No account needed{" "}
                <span style={{ color: "#d0d0c8" }}>·</span>
                {" "}Results in minutes
              </p>
            </div>
          </div>

          {/* Pain section */}
          <div style={{ padding: "80px 24px", maxWidth: 1152, margin: "0 auto" }}>
            <h2
              style={{
                fontFamily: "var(--font-sans, system-ui)",
                fontWeight: 700,
                fontSize: "clamp(22px, 3vw, 30px)",
                letterSpacing: "-0.02em",
                color: "#0a0a0a",
                textAlign: "center",
                marginBottom: 48,
              }}
            >
              The AI search problem no one is talking about
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Your competitor is in ChatGPT. You're not.",
                  body: "When a buyer asks ChatGPT to recommend tools in your category, your competitor's name comes up — yours doesn't.",
                },
                {
                  step: "02",
                  title: "Buyers research on AI before they Google anything.",
                  body: "Over 60% of B2B buyers now start product research on AI tools. If you're not there, you don't exist.",
                },
                {
                  step: "03",
                  title: "You're invisible where decisions are made.",
                  body: "Your SEO is fine. Your ads are running. But deals are being lost at the AI search layer — silently.",
                },
              ].map((card) => (
                <div
                  key={card.title}
                  style={{
                    background: "#f7f7f5",
                    border: "1px solid #e5e5e0",
                    borderRadius: 6,
                    padding: 24,
                    transition: "border-color 150ms ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#d0d0c8")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e5e5e0")}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 11,
                      color: "#1A3A2E",
                      letterSpacing: "0.1em",
                      marginBottom: 16,
                    }}
                  >
                    {card.step}
                  </p>
                  <h3
                    style={{
                      fontFamily: "var(--font-sans, system-ui)",
                      fontWeight: 600,
                      fontSize: 15,
                      color: "#0a0a0a",
                      lineHeight: 1.4,
                      marginBottom: 10,
                    }}
                  >
                    {card.title}
                  </h3>
                  <p
                    style={{
                      fontFamily: "var(--font-sans, system-ui)",
                      fontSize: 14,
                      color: "#555550",
                      lineHeight: 1.65,
                    }}
                  >
                    {card.body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div
            style={{
              borderTop: "1px solid #e5e5e0",
              padding: "80px 24px",
              background: "#f7f7f5",
            }}
          >
            <div style={{ maxWidth: 896, margin: "0 auto", textAlign: "center" }}>
              <h2
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontWeight: 700,
                  fontSize: "clamp(22px, 3vw, 30px)",
                  letterSpacing: "-0.02em",
                  color: "#0a0a0a",
                  marginBottom: 8,
                }}
              >
                How it works
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 12,
                  color: "#999990",
                  marginBottom: 56,
                }}
              >
                Three steps. Sixty seconds. Zero fluff.
              </p>
              <div className="grid gap-10 sm:grid-cols-3">
                {[
                  {
                    step: "01",
                    title: "Enter your domain",
                    body: "Type your company domain. No signup, no credit card, no friction.",
                  },
                  {
                    step: "02",
                    title: "We scan 4 AI engines",
                    body: "24 real buyer-intent prompts run across ChatGPT, Gemini, Claude & Perplexity — mapped to your specific ICP.",
                  },
                  {
                    step: "03",
                    title: "See your score",
                    body: "Get a visibility score by buyer intent stage — and exactly where to focus to fix the gaps.",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        border: "1px solid #e5e5e0",
                        background: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 20,
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#1A3A2E",
                      }}
                    >
                      {item.step}
                    </div>
                    <h3
                      style={{
                        fontFamily: "var(--font-sans, system-ui)",
                        fontWeight: 600,
                        fontSize: 15,
                        color: "#0a0a0a",
                        marginBottom: 10,
                      }}
                    >
                      {item.title}
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-sans, system-ui)",
                        fontSize: 14,
                        color: "#555550",
                        lineHeight: 1.65,
                      }}
                    >
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom CTA */}
          <div style={{ padding: "80px 24px", textAlign: "center", background: "#F5F1EA" }}>
            <div style={{ maxWidth: 560, margin: "0 auto" }}>
              <h2
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontWeight: 700,
                  fontSize: "clamp(22px, 3vw, 36px)",
                  letterSpacing: "-0.02em",
                  color: "#0a0a0a",
                  marginBottom: 12,
                }}
              >
                Ready to see where you stand?
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 12,
                  color: "#999990",
                  marginBottom: 36,
                }}
              >
                Free scan. No account. Takes 60 seconds.
              </p>
              <div style={{ display: "flex", gap: 8, maxWidth: 480, margin: "0 auto" }}>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => onDomainChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onScan(domain)}
                  placeholder="yourdomain.com"
                  style={{
                    flex: 1,
                    background: "#f7f7f5",
                    border: "1px solid #e5e5e0",
                    borderRadius: 6,
                    padding: "11px 16px",
                    fontSize: 14,
                    color: "#0a0a0a",
                    outline: "none",
                    transition: "border-color 150ms ease",
                    fontFamily: "var(--font-sans, system-ui)",
                    minWidth: 0,
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#0a0a0a")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e0")}
                />
                <button
                  onClick={() => onScan(domain)}
                  disabled={!domain.trim()}
                  style={{
                    background: "#1A3A2E",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 6,
                    padding: "11px 20px",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "var(--font-sans, system-ui)",
                    cursor: !domain.trim() ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                    opacity: !domain.trim() ? 0.5 : 1,
                    transition: "background 150ms ease",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (domain.trim()) e.currentTarget.style.background = "#243F33";
                  }}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#1A3A2E")}
                >
                  Check My Visibility
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
