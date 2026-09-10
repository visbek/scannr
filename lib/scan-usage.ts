import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

export type UsageEvent = {
  provider: string; stage: string; model?: string; status: number | 'network-error' | 'blocked';
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
  searchCalls?: number; thinkingTokens?: number; reportedCostUsd?: number;
};
export type ScanUsage = { requestId: string; flowId: string; route: string; events: UsageEvent[]; reused: Record<string, number>; researchIncomplete?: boolean; limit: number };
const context = new AsyncLocalStorage<ScanUsage>();
const number = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
export function usageSnapshot(): ScanUsage | undefined {
  const c = context.getStore();
  return c ? { ...c, events: c.events.map(e => ({ ...e })), reused: { ...c.reused } } : undefined;
}
export function noteReuse(name: string) { const c = context.getStore(); if (c) c.reused[name] = (c.reused[name] ?? 0) + 1; }
export function noteResearchFailure() { const c = context.getStore(); if (c) c.researchIncomplete = true; }
export function hasProviderFailures() { const c = context.getStore(); return !!c && (!!c.researchIncomplete || c.events.some(e => e.status !== 200)); }
export async function withScanUsage<T>(route: string, flowId: string | null, work: () => Promise<T>): Promise<T> {
  const requestId = randomUUID();
  const configured = Number(process.env.SCANRR_MAX_PROVIDER_CALLS);
  const limit = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 600) : 600;
  const usage: ScanUsage = { requestId, flowId: flowId && /^[a-f0-9-]{36}$/i.test(flowId) ? flowId : requestId, route, events: [], reused: {}, limit };
  return context.run(usage, async () => {
    try { return await work(); }
    finally { console.info('[scan-usage]', JSON.stringify(usageSnapshot())); }
  });
}
export function measuredRoute(route: string, handler: (r: NextRequest) => Promise<Response>) {
  return (r: NextRequest) => withScanUsage(route, r.headers.get('x-scan-flow-id'), async () => {
    const response = await handler(r);
    response.headers.set('x-scan-request-id', context.getStore()!.requestId);
    return response;
  });
}

// Extract only numeric billing metadata, never prompts, answers, URLs or credentials.
export function readProviderUsage(provider: string, payload: unknown): Partial<UsageEvent> {
  const d = record(payload), u = record(d.usage);
  if (provider === 'claude') return {
    inputTokens: number(u.input_tokens), outputTokens: number(u.output_tokens),
    cacheReadTokens: number(u.cache_read_input_tokens), cacheWriteTokens: number(u.cache_creation_input_tokens),
    searchCalls: number(record(u.server_tool_use).web_search_requests),
  };
  if (provider === 'gemini') { const g = record(d.usageMetadata); return {
    inputTokens: number(g.promptTokenCount), outputTokens: number(g.candidatesTokenCount), thinkingTokens: number(g.thoughtsTokenCount),
    cacheReadTokens: number(g.cachedContentTokenCount),
    // Grounding metadata is not an invoice or a count of billable searches.
  }; }
  if (provider === 'chatgpt') return {
    inputTokens: number(u.input_tokens), outputTokens: number(u.output_tokens), cacheReadTokens: number(record(u.input_tokens_details).cached_tokens),
    searchCalls: Array.isArray(d.output) ? d.output.filter(x => record(x).type === 'web_search_call').length : undefined,
  };
  if (provider === 'perplexity') return {
    inputTokens: number(u.prompt_tokens), outputTokens: number(u.completion_tokens), reportedCostUsd: number(record(u.cost).total_cost),
  };
  return {};
}
export function providerFetch(stage: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const provider = ({ 'api.anthropic.com': 'claude', 'api.openai.com': 'chatgpt', 'api.perplexity.ai': 'perplexity',
      'generativelanguage.googleapis.com': 'gemini', 'google.serper.dev': 'serper' } as Record<string, string>)[url.hostname];
    if (!provider) return fetch(input, init);
    const c = context.getStore();
    if (c && c.events.length >= c.limit) throw new Error('Scan provider-call limit reached');
    let model: string | undefined;
    try { const body = JSON.parse(String(init?.body)); if (typeof body.model === 'string') model = body.model.slice(0, 100); } catch {}
    if (provider === 'gemini') model = url.pathname.split('/models/')[1]?.split(':')[0];
    const event: UsageEvent = { provider, stage, model, status: 'network-error' };
    c?.events.push(event); // Reserve synchronously before concurrent requests begin.
    try {
      const response = await fetch(input, init);
      event.status = response.status;
      try { Object.assign(event, readProviderUsage(provider, await response.clone().json())); } catch { /* Missing usage stays unknown. */ }
      return response;
    } catch (error) { event.status = 'network-error'; throw error; }
  };
}
