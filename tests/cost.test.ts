import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCache } from '../lib/research-cache';
import { searchSerper } from '../lib/serper';
import { providerFetch, withScanUsage, usageSnapshot, readProviderUsage } from '../lib/scan-usage';

test('research cache shares concurrent work, expires, and never caches failures', async () => {
  const cache = createMemoryCache();
  let calls = 0;
  const work = async () => { calls++; return { answer: 42 }; };
  assert.deepEqual(await Promise.all([cache('same', 60, work), cache('same', 60, work)]), [{ answer: 42 }, { answer: 42 }]);
  await cache('same', 60, work); assert.equal(calls, 1);
  await cache('expired', -1, work); await cache('expired', -1, work); assert.equal(calls, 3);
  await assert.rejects(cache('error', 60, async () => { throw Error('provider failed'); }));
  assert.equal(await cache('error', 60, async () => 'recovered'), 'recovered');
});

test('Serper deduplicates equivalent requests, separates geography/type, and retries failed searches on next request', async () => {
  const saved = { ...process.env }, original = globalThis.fetch;
  process.env.SCANRR_CACHE_MODE = 'memory'; process.env.SERPER_API_KEY = 'isolated-cost-test';
  let calls = 0, fail = true;
  globalThis.fetch = async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    if (body.q === 'retry-test' && fail) { fail = false; return Response.json({ error: 'rate limited' }, { status: 429 }); }
    return Response.json({ organic: [{ title: 'research' }] });
  };
  try {
    await withScanUsage('test', null, async () => {
      await Promise.all([searchSerper(' software ', { gl: 'us' }), searchSerper('software', { gl: 'us' })]);
      await searchSerper('software', { gl: 'us' }); assert.equal(calls, 1);
      await searchSerper('software', { gl: 'gb' });
      await searchSerper('software', { gl: 'us', type: 'videos' }); assert.equal(calls, 3);
      await assert.rejects(searchSerper('retry-test')); await searchSerper('retry-test'); assert.equal(calls, 5);
      const usage = usageSnapshot()!;
      assert.equal(usage.events.length, 5); assert.ok(Object.values(usage.reused).reduce((a,b) => a+b,0) >= 2);
      assert.ok(!JSON.stringify(usage).includes('isolated-cost-test'));
    });
  } finally { globalThis.fetch = original; for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
});

test('usage records numeric provider metadata, leaves unknown token counts unknown', () => {
  assert.deepEqual(readProviderUsage('claude', { usage: { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 99, server_tool_use: { web_search_requests: 2 } } }),
    { inputTokens: 123, outputTokens: 45, cacheReadTokens: 99, cacheWriteTokens: undefined, searchCalls: 2 });
  assert.equal(readProviderUsage('gemini', { usageMetadata: { promptTokenCount: 50, thoughtsTokenCount: 20 } }).thinkingTokens, 20);
  assert.equal(readProviderUsage('chatgpt', { usage: { input_tokens: 25 }, output: [{type:'web_search_call'}] }).searchCalls, 1);
  assert.equal(readProviderUsage('perplexity', { usage: { cost: { total_cost: .006 } } }).reportedCostUsd, .006);
  assert.equal(readProviderUsage('claude', {}).inputTokens, undefined);
});

test('concurrent provider calls respect a per-request ceiling and separate usage contexts', async () => {
  const original = globalThis.fetch, previous = process.env.SCANRR_MAX_PROVIDER_CALLS;
  process.env.SCANRR_MAX_PROVIDER_CALLS = '2'; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ usage: { input_tokens: 3, output_tokens: 1 } }); };
  try {
    const run = () => withScanUsage('limit-test', null, async () => {
      const outcomes = await Promise.allSettled(Array.from({length:3}, () => providerFetch('test')('https://api.anthropic.com/v1/messages', { method:'POST' })));
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length, 2);
      assert.equal(usageSnapshot()!.events.length, 2); return usageSnapshot()!.requestId;
    });
    const ids = await Promise.all([run(), run()]); assert.notEqual(ids[0], ids[1]); assert.equal(calls, 4);
  } finally { globalThis.fetch = original; if (previous === undefined) delete process.env.SCANRR_MAX_PROVIDER_CALLS; else process.env.SCANRR_MAX_PROVIDER_CALLS = previous; }
});
