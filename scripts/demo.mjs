import { spawn } from "node:child_process";

const env = {
  ...process.env,
  SCANRR_DEMO: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "demo-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "demo-placeholder",
};
// Override inherited keys so .env loading cannot re-enable these services.
for (const key of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GEMINI_API_KEY_2", "OPENAI_API_KEY", "PERPLEXITY_API_KEY", "SERPER_API_KEY", "RESEND_API_KEY"]) {
  env[key] = "demo-disabled";
}
console.log("\nScanrr sample report: http://127.0.0.1:3000/demo\nLive APIs and actions are blocked in this demo. Sample data only.\n");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3000"], { env, stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
