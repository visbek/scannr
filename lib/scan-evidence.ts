export type AnswerEvidence = { text: string; citations: string[] };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";

function evidence(text: string, citations: string[]): AnswerEvidence {
  if (!text.trim()) throw new Error("Engine returned no final answer");
  const inlineUrls = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  return {
    text,
    citations: [...new Set([...citations, ...inlineUrls.map((url) => url.replace(/[.,;!?\])]+$/, ""))])],
  };
}

export function readClaudeAnswer(data: unknown) {
  const root = object(data);
  if (root.stop_reason && root.stop_reason !== "end_turn") throw new Error("Engine returned incomplete answer");
  if (list(root.content).some(b => object(object(b).content).type === "web_search_tool_result_error")) throw new Error("Engine returned incomplete answer");
  const blocks = list(object(data).content).map(object).filter((b) => b.type === "text");
  return evidence(blocks.map((b) => string(b.text)).join("\n"),
    blocks.flatMap((b) => list(b.citations).map((c) => string(object(c).url))).filter(Boolean));
}

export function readOpenAIAnswer(data: unknown) {
  const root = object(data);
  if (root.status && root.status !== "completed") throw new Error("Engine returned incomplete answer");
  const blocks = list(object(data).output).map(object).filter((b) => b.type === "message")
    .flatMap((b) => list(b.content).map(object)).filter((b) => b.type === "output_text");
  return evidence(blocks.map((b) => string(b.text)).join("\n"),
    blocks.flatMap((b) => list(b.annotations).map((c) => string(object(c).url))).filter(Boolean));
}

export function readGeminiAnswer(data: unknown) {
  const candidate = object(list(object(data).candidates)[0]);
  if (candidate.finishReason && candidate.finishReason !== "STOP") throw new Error("Engine returned incomplete answer");
  const text = list(object(candidate.content).parts).map(object).filter((p) => !p.thought).map((p) => string(p.text)).join("\n");
  const metadata = object(candidate.groundingMetadata);
  const chunks = list(metadata.groundingChunks);
  // Only chunks linked to the answer by a grounding support count as citations.
  const indices = list(metadata.groundingSupports).flatMap((s) => list(object(s).groundingChunkIndices));
  return evidence(text, indices.filter((i): i is number => typeof i === "number")
    .map((i) => string(object(object(chunks[i]).web).uri)).filter(Boolean));
}

export function readPerplexityAnswer(data: unknown) {
  const root = object(data);
  const finish = object(list(root.choices)[0]).finish_reason;
  if (finish && finish !== "stop") throw new Error("Engine returned incomplete answer");
  return evidence(string(object(object(list(root.choices)[0]).message).content),
    list(root.citations).map((c) => typeof c === "string" ? c : string(object(c).url)).filter(Boolean));
}
