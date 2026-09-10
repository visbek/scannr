"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) setError(error.message);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F5F1EA",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Back link */}
        <div style={{ marginBottom: 24 }}>
          <a
            href="https://scanrr.sparrwo.com"
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              color: "#888",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#0a0a0a")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          >
            ← Back to Scanrr
          </a>
        </div>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <a
            href="/"
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontWeight: 700,
              fontSize: 20,
              color: "#0a0a0a",
              textDecoration: "none",
              letterSpacing: "-0.02em",
            }}
          >
            Scanrr
          </a>
        </div>

        <div
          style={{
            background: "#f7f7f5",
            border: "1px solid #e5e5e0",
            borderRadius: 8,
            padding: 32,
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontWeight: 700,
              fontSize: 22,
              color: "#0a0a0a",
              marginBottom: 8,
              letterSpacing: "-0.02em",
            }}
          >
            Sign in
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans, system-ui)",
              fontSize: 14,
              color: "#555550",
              marginBottom: 28,
            }}
          >
            Welcome back. Sign in to your account.
          </p>

          {/* Google */}
          <button
            onClick={handleGoogle}
            style={{
              width: "100%",
              background: "#ffffff",
              color: "#0a0a0a",
              border: "1px solid #e5e5e0",
              borderRadius: 6,
              padding: "11px 16px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-sans, system-ui)",
              cursor: "pointer",
              marginBottom: 20,
              transition: "border-color 150ms ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#0a0a0a")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e5e5e0")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#e5e5e0" }} />
            <span style={{ fontSize: 12, color: "#999990", fontFamily: "var(--font-mono, monospace)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "#e5e5e0" }} />
          </div>

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#0a0a0a",
                  marginBottom: 6,
                }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                style={{
                  width: "100%",
                  background: "#ffffff",
                  border: "1px solid #e5e5e0",
                  borderRadius: 6,
                  padding: "10px 14px",
                  fontSize: 14,
                  color: "#0a0a0a",
                  outline: "none",
                  fontFamily: "var(--font-sans, system-ui)",
                  boxSizing: "border-box",
                  transition: "border-color 150ms ease",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0a0a0a")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e0")}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontFamily: "var(--font-sans, system-ui)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#0a0a0a",
                  marginBottom: 6,
                }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: "100%",
                  background: "#ffffff",
                  border: "1px solid #e5e5e0",
                  borderRadius: 6,
                  padding: "10px 14px",
                  fontSize: 14,
                  color: "#0a0a0a",
                  outline: "none",
                  fontFamily: "var(--font-sans, system-ui)",
                  boxSizing: "border-box",
                  transition: "border-color 150ms ease",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0a0a0a")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e5e0")}
              />
            </div>

            {error && (
              <p style={{ fontSize: 13, color: "#dc2626", fontFamily: "var(--font-sans, system-ui)" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                background: loading ? "#f0f0ed" : "#1A3A2E",
                color: loading ? "#999990" : "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "11px 16px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-sans, system-ui)",
                cursor: loading ? "not-allowed" : "pointer",
                marginTop: 4,
                transition: "background 150ms ease",
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "#243F33"; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = "#1A3A2E"; }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        <p
          style={{
            textAlign: "center",
            marginTop: 20,
            fontFamily: "var(--font-sans, system-ui)",
            fontSize: 14,
            color: "#555550",
          }}
        >
          Don&apos;t have an account?{" "}
          <a
            href="/signup"
            style={{ color: "#1A3A2E", textDecoration: "none", fontWeight: 500 }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            Sign up free
          </a>
        </p>
      </div>
    </main>
  );
}
