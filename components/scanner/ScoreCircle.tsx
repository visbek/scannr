"use client";

import { useState, useEffect, useRef } from "react";

const R = 54;
const CIRC = 2 * Math.PI * R;

function scoreColor(score: number | null) {
  if (score === null) return "#777";
  if (score > 66) return "#16a34a";
  if (score >= 33) return "#f97316";
  return "#dc2626";
}

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

export function ScoreCircle({ score, active }: { score: number | null; active: boolean }) {
  const display = useCountUp(score ?? 0, active && score !== null);
  const [go, setGo] = useState(false);

  useEffect(() => {
    if (active) {
      const t = setTimeout(() => setGo(true), 80);
      return () => clearTimeout(t);
    }
    setGo(false);
  }, [active]);

  const offset = go ? CIRC * (1 - (score ?? 0) / 100) : CIRC;

  return (
    <div className="relative" style={{ width: 160, height: 160 }}>
      <svg
        width="160"
        height="160"
        viewBox="0 0 160 160"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {/* Track */}
        <circle cx="80" cy="80" r={R} fill="none" stroke="#e5e5e0" strokeWidth="3" />
        {/* Progress arc — always orange */}
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          stroke="#f97316"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform="rotate(-90 80 80)"
          style={{
            transition: "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)",
            filter: "drop-shadow(0 0 6px rgba(249,115,22,0.4))",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 40,
            fontWeight: 700,
            lineHeight: 1,
            color: scoreColor(score),
          }}
        >
          {score === null ? "—" : display}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 10,
            color: "#999990",
            marginTop: 4,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          / 100
        </span>
      </div>
    </div>
  );
}
