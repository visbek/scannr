import { cachedResearch, researchKey } from './research-cache';
import { providerFetch } from './scan-usage';

export async function searchSerper(q: string, options: { type?: 'search' | 'videos'; gl?: string; num?: number } = {}): Promise<Record<string, unknown>> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('Serper is not configured');
  const type = options.type ?? 'search';
  const body = { q: q.trim(), ...(options.gl ? { gl: options.gl } : {}), num: options.num ?? 10 };
  return cachedResearch('serper', [researchKey(key), type, body], 86400, async () => {
    const response = await providerFetch('search-research')(`https://google.serper.dev/${type}`, {
      method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Serper request failed (${response.status})`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || 'error' in data ||
      !['organic', 'peopleAlsoAsk', 'videos', 'searchParameters'].some(field => field in data)) throw new Error('Invalid Serper response');
    return data as Record<string, unknown>;
  });
}
