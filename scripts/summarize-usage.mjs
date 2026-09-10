import { readFileSync } from 'node:fs';
const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/summarize-usage.mjs exported-runtime.log'); process.exit(1); }
const groups = new Map(), ids = new Set(), flows = new Set();
let reused = 0;
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const marker = line.indexOf('[scan-usage] '); if (marker < 0) continue;
  let usage; try { usage = JSON.parse(line.slice(marker + 13)); } catch { continue; }
  if (!usage.requestId || ids.has(usage.requestId)) continue;
  ids.add(usage.requestId); flows.add(usage.flowId);
  reused += Object.values(usage.reused || {}).reduce((sum, n) => sum + Number(n), 0);
  for (const e of usage.events || []) {
    const key = `${e.provider} / ${e.stage} / ${e.model || 'n/a'}`;
    const row = groups.get(key) || { calls:0, failed:0, inputTokens:0, outputTokens:0, searchCalls:0, missingTokenUsage:0 };
    row.calls++; if (e.status !== 200) row.failed++;
    row.inputTokens += e.inputTokens ?? 0; row.outputTokens += e.outputTokens ?? 0; row.searchCalls += e.searchCalls ?? 0;
    if (e.provider !== 'serper' && (e.inputTokens === undefined || e.outputTokens === undefined)) row.missingTokenUsage++;
    groups.set(key, row);
  }
}
console.log(JSON.stringify({ requests:ids.size, scanFlows:flows.size, reusedOperations:reused,
  note:'Token and search totals include reported values only. Missing values and failed requests may still be billed. No dollar cost is inferred.',
  byProviderAndStage:Object.fromEntries(groups) }, null, 2));
