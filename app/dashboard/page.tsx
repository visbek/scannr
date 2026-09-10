"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

interface Scan {
  id: string;
  domain: string;
  score: number | null;
  created_at: string;
}

interface Profile {
  plan: string;
  scans_used: number;
  scans_limit: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setUser(user);

      const [{ data: scansData }, { data: profileData }] = await Promise.all([
        supabase
          .from("scans")
          .select("id, domain, score, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("plan, scans_used, scans_limit")
          .eq("id", user.id)
          .single(),
      ]);

      setScans(scansData ?? []);
      setProfile(profileData ?? null);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#F5F1EA",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 13,
            color: "#999990",
          }}
        >
          Loading...
        </span>
      </main>
    );
  }

  const measuredScores = scans.flatMap((scan) => scan.score === null ? [] : [scan.score]);
  const avgScore = measuredScores.length
    ? Math.round(measuredScores.reduce((sum, score) => sum + score, 0) / measuredScores.length)
    : null;
  const bestScore = measuredScores.length ? Math.max(...measuredScores) : null;

  const scansRemaining = profile
    ? profile.scans_limit - profile.scans_used
    : null;

  return (
    <main style={{ minHeight: "100vh", background: "#F5F1EA" }}>
      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid #e5e5e0",
          padding: "0 24px",
          height: 57,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          background: "#F5F1EA",
          zIndex: 40,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-sans, system-ui)",
            fontWeight: 700,
            fontSize: 16,
            color: "#0E1F18",
            letterSpacing: "-0.02em",
          }}
        >
          Scanrr
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontSize: 13,
              color: "#555550",
            }}
          >
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            style={{
              background: "none",
              border: "1px solid #e5e5e0",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "var(--font-sans, system-ui)",
              color: "#555550",
              cursor: "pointer",
              transition: "border-color 150ms ease, color 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#0a0a0a";
              e.currentTarget.style.color = "#0a0a0a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#e5e5e0";
              e.currentTarget.style.color = "#555550";
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
        {/* Page title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 32,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: "var(--font-sans, system-ui)",
                fontWeight: 700,
                fontSize: 24,
                color: "#0a0a0a",
                letterSpacing: "-0.02em",
                marginBottom: 4,
              }}
            >
              Dashboard
            </h1>
            {profile && (
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11,
                  color: "#1A3A2E",
                  background: "rgba(26,58,46,0.08)",
                  border: "1px solid rgba(26,58,46,0.2)",
                  borderRadius: 4,
                  padding: "2px 8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {profile.plan} plan
                {scansRemaining !== null ? ` · ${scansRemaining} scans remaining` : ""}
              </span>
            )}
          </div>

          <a
            href="/"
            style={{
              background: "#1A3A2E",
              color: "#ffffff",
              border: "none",
              borderRadius: 6,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-sans, system-ui)",
              textDecoration: "none",
              transition: "background 150ms ease",
              display: "inline-block",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#243F33")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1A3A2E")}
          >
            + New Scan
          </a>
        </div>

        {/* Stats row */}
        <div
          className="grid gap-4 sm:grid-cols-3"
          style={{ marginBottom: 40 }}
        >
          {[
            { label: "Total scans", value: scans.length },
            { label: "Average score", value: avgScore !== null ? `${avgScore}/100` : "—" },
            { label: "Best score", value: bestScore !== null ? `${bestScore}/100` : "—" },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: "#f7f7f5",
                border: "1px solid #e5e5e0",
                borderRadius: 8,
                padding: "20px 24px",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11,
                  color: "#999990",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                {stat.label}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontWeight: 700,
                  fontSize: 28,
                  color: "#0a0a0a",
                  letterSpacing: "-0.02em",
                }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Scans table */}
        <div>
          <h2
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontWeight: 600,
              fontSize: 16,
              color: "#0a0a0a",
              marginBottom: 16,
            }}
          >
            Past scans
          </h2>

          {scans.length === 0 ? (
            <div
              style={{
                background: "#f7f7f5",
                border: "1px solid #e5e5e0",
                borderRadius: 8,
                padding: "48px 24px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 14,
                  color: "#555550",
                  marginBottom: 16,
                }}
              >
                No scans yet.
              </p>
              <a
                href="/"
                style={{
                  color: "#1A3A2E",
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 14,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
              >
                Scan your first domain →
              </a>
            </div>
          ) : (
            <div
              style={{
                background: "#f7f7f5",
                border: "1px solid #e5e5e0",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 160px 120px",
                  padding: "12px 20px",
                  borderBottom: "1px solid #e5e5e0",
                  background: "#f0f0ed",
                }}
              >
                {["Domain", "Score", "Date", ""].map((col) => (
                  <span
                    key={col}
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 11,
                      color: "#999990",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {col}
                  </span>
                ))}
              </div>

              {/* Rows */}
              {scans.map((scan, i) => (
                <div
                  key={scan.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 160px 120px",
                    padding: "14px 20px",
                    borderBottom: i < scans.length - 1 ? "1px solid #e5e5e0" : "none",
                    alignItems: "center",
                    transition: "background 150ms ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0ed")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-sans, system-ui)",
                      fontSize: 14,
                      color: "#0a0a0a",
                      fontWeight: 500,
                    }}
                  >
                    {scan.domain}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 14,
                      color: scan.score !== null
                        ? scan.score >= 60 ? "#16a34a" : scan.score >= 30 ? "#f97316" : "#dc2626"
                        : "#999990",
                      fontWeight: 600,
                    }}
                  >
                    {scan.score !== null ? `${scan.score}/100` : "—"}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                      color: "#999990",
                    }}
                  >
                    {new Date(scan.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <a
                    href={`/reports/${scan.id}`}
                    style={{
                      fontFamily: "var(--font-sans, system-ui)",
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#555550",
                      textDecoration: "none",
                      transition: "color 150ms ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#1A3A2E")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#555550")}
                  >
                    View Report →
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
