# Scan cost controls

Released methodology: `answer-visibility-v3-bounded`.

The scanner keeps 24 buyer questions and the existing four model identities.
This is an API-based sample, not a replay of consumer chat interfaces.

## What is bounded

| Provider | Answer request controls |
| --- | --- |
| Claude Sonnet 4.5 | At most 2 web searches per answer; 1,000 output tokens; no SDK retries |
| OpenAI GPT-4o-mini | At most 2 built-in tool calls per answer; 1,600 output tokens |
| Gemini 2.5 Flash | 2,048 output tokens; one request at a time per scan; at most 2 retry calls in the whole scan |
| Perplexity Sonar | Existing 500-token answer limit |

Gemini retries only HTTP 429/503, once for an affected question, and honors
the provider's requested delay when it fits the 15-second retry wait budget.
Daily quota errors, longer requested delays and continued failures stop queued
requests for that engine. Other engines continue. The shared scan deadline
cancels retry waits. These controls are per scan, not a project-wide quota manager.
They cannot create provider credits or increase a free-tier quota.

The per-question Google result-count validation was removed. It consumed up to
12 Serper requests plus a conditional Claude rewrite and did not establish buyer
demand. Business research, competitor research and unbranded/contextual prompt
validation remain. Google result counts must never be labelled search volume.

## Evidence and trade-offs

Answers that report truncation, incomplete generation or a failed Claude search
are excluded from scoring. Saved reports retain provider warnings and a new
methodology version. Limited research can change which brands are returned, so
scores from the earlier method are not directly comparable without a new baseline.
Bounds can reduce coverage on complex questions; this must remain visible.

These are request/search/output limits, not a guaranteed dollar ceiling. Provider
input tokens, retrieved context, auxiliary research and concurrent scans still
incur costs. Numeric usage is recorded by `lib/scan-usage.ts`; do not infer exact
scan cost from unrelated account-wide balance changes.

## Verification

Automated tests mock provider responses: no paid scan is required for tests.
They cover outgoing budgets, absent hidden retries, Retry-After handling, daily
quota classification, scan-wide retry limits, deadline cancellation, incomplete
answer rejection and isolation between a failed Gemini run and successful OpenAI
checks. A controlled live comparison is still required to establish actual dollar
savings and answer-quality impact. Do not advertise an unmeasured savings percent.

Provider references:
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- https://platform.openai.com/docs/api-reference/responses/create
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/troubleshooting
