import Anthropic from "@anthropic-ai/sdk";
import { setTimeout as delay } from "node:timers/promises";
import { providerFetch, noteReuse } from "./scan-usage";
import { readClaudeAnswer, readGeminiAnswer, readOpenAIAnswer, readPerplexityAnswer, type AnswerEvidence } from "./scan-evidence";

type Engine = "gemini" | "claude" | "chatgpt" | "perplexity";
export type FailureReason = "rate_limit" | "quota_exhausted" | "provider_access" | "provider_unavailable" | "incomplete_answer" | "request_failed";
export const FAILURE_MESSAGES: Record<FailureReason, string> = {
  rate_limit: "Provider rate limit reached. Some checks could not be completed.",
  quota_exhausted: "Provider quota exhausted. Remaining checks were not run.",
  provider_access: "Provider access or billing requires attention. Remaining checks were not run.",
  provider_unavailable: "Provider temporarily unavailable. Some checks could not be completed.",
  incomplete_answer: "Some answers were incomplete and have been excluded from scoring.",
  request_failed: "Some checks failed and have been excluded from scoring.",
};

export class ProviderRequestError extends Error {
  constructor(public reason: FailureReason, public status: number, public retryAfterMs?: number) {
    super(FAILURE_MESSAGES[reason]);
  }
}

export function failureReason(error: unknown): FailureReason {
  if (error instanceof ProviderRequestError) return error.reason;
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 429) return "rate_limit";
  if ([400, 401, 402, 403, 404].includes(Number(status))) return "provider_access";
  if (Number(status) >= 500) return "provider_unavailable";
  if (error instanceof Error && error.message === "Engine returned incomplete answer") return "incomplete_answer";
  return "request_failed";
}

async function responseError(response: Response): Promise<ProviderRequestError> {
  // Read only retry/quota metadata. Never include provider bodies or keys in reports.
  const data = await response.json().catch(() => ({}));
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  const daily = details.some((detail: { violations?: { quotaId?: string }[] }) =>
    detail.violations?.some(v => /perday|daily/i.test(v.quotaId ?? "")));
  const retry = details.find((detail: { retryDelay?: string }) => typeof detail.retryDelay === "string")?.retryDelay;
  const seconds = typeof retry === "string" && /^\d+(\.\d+)?s$/.test(retry) ? Number(retry.slice(0, -1)) : undefined;
  const header = response.headers.get("retry-after");
  const headerMs = header === null ? undefined : /^\d+(\.\d+)?$/.test(header)
    ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now());
  const values = [headerMs, seconds === undefined ? undefined : seconds * 1000].filter((n): n is number => n !== undefined && Number.isFinite(n));
  const retryAfterMs = values.length ? Math.max(...values) : undefined;
  const reason = response.status === 429 ? daily ? "quota_exhausted" : "rate_limit"
    : [400, 401, 402, 403, 404].includes(response.status) ? "provider_access" : "provider_unavailable";
  return new ProviderRequestError(reason, response.status, retryAfterMs);
}

export async function fetchEngineAnswer(engine: Engine, prompt: string, apiKey: string, deadline: AbortSignal): Promise<AnswerEvidence> {
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(45_000)]);
  if (engine === "claude") {
    const client = new Anthropic({ fetch: providerFetch("answers.claude"), apiKey, maxRetries: 0, timeout: 45_000 });
    const message = await client.messages.create({
      model: "claude-sonnet-4-5", max_tokens: 1000, temperature: 0,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      messages: [{ role: "user", content: prompt }],
    }, { signal });
    return readClaudeAnswer(message);
  }
  const config = engine === "gemini" ? {
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 2048 }, tools: [{ googleSearch: {} }] },
  } : engine === "chatgpt" ? {
    url: "https://api.openai.com/v1/responses",
    body: { model: "gpt-4o-mini", tools: [{ type: "web_search_preview" }], max_tool_calls: 2, max_output_tokens: 1600, input: prompt },
  } : {
    url: "https://api.perplexity.ai/chat/completions",
    body: { model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: 500, temperature: 0 },
  };
  const response = await providerFetch(`answers.${engine}`)(config.url, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", ...(engine !== "gemini" ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(config.body),
  });
  if (!response.ok) throw await responseError(response);
  const data: unknown = await response.json();
  return engine === "gemini" ? readGeminiAnswer(data) : engine === "chatgpt" ? readOpenAIAnswer(data) : readPerplexityAnswer(data);
}

// State belongs to one scan and one engine. Never retry an entire paid scan.
export function createEngineRunner(engine: Engine, key: string, deadline: AbortSignal,
  request = fetchEngineAnswer,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal })) {
  let stopped: FailureReason | undefined;
  let retries = 0; // At most two extra Gemini calls across the whole scan.
  return async (prompt: string): Promise<AnswerEvidence> => {
    if (stopped) { noteReuse("provider-circuit-open"); throw new ProviderRequestError(stopped, 0); }
    deadline.throwIfAborted();
    try { return await request(engine, prompt, key, deadline); }
    catch (error) {
      const reason = failureReason(error);
      const retryable = engine === "gemini" && error instanceof ProviderRequestError && [429, 503].includes(error.status) && reason !== "quota_exhausted";
      const waitMs = error instanceof ProviderRequestError ? error.retryAfterMs ?? 1500 : 1500;
      if (retryable && retries < 2 && waitMs <= 15_000) {
        retries++;
        // Never retry before the provider's requested delay. Deadline cancels the wait.
        await wait(Math.max(1000, waitMs) + 100, deadline);
        deadline.throwIfAborted();
        try { return await request(engine, prompt, key, deadline); }
        catch (retryError) {
          stopped = failureReason(retryError);
          throw retryError;
        }
      }
      if (["rate_limit", "quota_exhausted", "provider_access", "provider_unavailable"].includes(reason)) stopped = reason;
      throw error;
    }
  };
}
