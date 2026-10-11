import type { Config } from '../config.ts';
import { Failure, object } from '../contracts/index.ts';
import { outputSchema } from '../preparation/cards.ts';

export type ProviderDiagnostic = { provider: string; model?: string; httpStatus?: number; providerStatus?: string; providerMessage?: string; finishReason?: string; blockReason?: string; promptTokens?: number; outputTokens?: number; thinkingTokens?: number; totalTokens?: number; outputCharacters?: number; networkError?: string };
export type Generate = (prompt: string, report?: (diagnostic: ProviderDiagnostic) => void) => Promise<unknown>;
export async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Failure('empty_upstream_response');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 1024 * 1024) throw new Failure('upstream_response_too_large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) { await reader.cancel(); if (e instanceof Failure) throw e; throw new Failure('invalid_upstream_json'); }
}
export function upstreamFailure(response: Response) {
  const retry = response.headers.get('retry-after');
  const seconds = Number(retry);
  const wait = retry ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now()) : 0;
  return new Failure(response.status === 429 ? 'quota_exhausted' : response.status >= 500 ? 'upstream_unavailable' :
    [401,403].includes(response.status) ? 'provider_credentials_or_access' : 'provider_configuration', 502, Math.max(0, wait || 0));
}
export function cloudGenerator(config: Config, fetcher: typeof fetch = fetch): Generate {
  return async (prompt, report) => {
    if (config.provider === 'disabled') throw new Failure('generation_disabled');
    // UTF-8 byte count is a deliberately conservative input-token bound.
    if (Buffer.byteLength(prompt + JSON.stringify(outputSchema)) > config.maxInput) throw new Failure('input_budget_exceeded');
    const gemini = config.provider === 'gemini';
    const url = gemini ? `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent` : 'https://api.openai.com/v1/responses';
    const body = gemini ? {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: config.maxOutput, responseMimeType: 'application/json', responseJsonSchema: outputSchema,
        ...(config.thinkingLevel ? { thinkingConfig: { thinkingLevel: config.thinkingLevel } } : {}) },
    } : {
      model: config.model, store: false, input: prompt, max_output_tokens: config.maxOutput,
      text: { format: { type: 'json_schema', name: 'learning_cards', strict: true, schema: outputSchema } },
    };
    let response: Response;
    const signal = AbortSignal.timeout(config.timeout);
    try { response = await fetcher(url, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(gemini ? { 'x-goog-api-key': config.key! } : { Authorization: `Bearer ${config.key}` }) }, body: JSON.stringify(body) }); }
    catch (error) { report?.({ provider: config.provider, model: config.model, networkError: error instanceof Error ? error.name : 'NetworkError' }); throw new Failure('upstream_timeout_or_network'); }
    if (!response.ok) {
      const diagnostic: ProviderDiagnostic = { provider: config.provider, model: config.model, httpStatus: response.status };
      try {
        const raw = object(await readJson(response));
        const e = object(raw.error);
        if (typeof e.status === 'string' && /^[A-Z_]{1,64}$/.test(e.status)) diagnostic.providerStatus = e.status;
        if (typeof e.message === 'string') {
          let message = e.message;
          for (const secret of [config.key, config.token]) if (secret) message = message.replaceAll(secret, '[REDACTED]');
          diagnostic.providerMessage = message.replace(/([?&](?:key|api_key)=)[^&\s]+/gi, '$1[REDACTED]').slice(0, 512);
        }
      } catch { /* An unreadable error body must not mask the HTTP status. */ }
      report?.(diagnostic); throw upstreamFailure(response);
    }
    const result = object(await readJson(response));
    let text = '';
    if (gemini) {
      const candidates = result.candidates as { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] | undefined;
      const candidate = candidates?.[0];
      const feedback = result.promptFeedback as { blockReason?: string } | undefined;
      const usage = result.usageMetadata as Record<string, unknown> | undefined;
      const numeric = (key: string) => typeof usage?.[key] === 'number' && Number.isSafeInteger(usage[key]) && (usage[key] as number) >= 0 ? usage[key] as number : undefined;
      const tag = (value: unknown) => typeof value === 'string' && /^[A-Z_]{1,64}$/.test(value) ? value : undefined;
      report?.({ provider: config.provider, model: config.model, httpStatus: response.status, finishReason: tag(candidate?.finishReason), blockReason: tag(feedback?.blockReason),
        promptTokens: numeric('promptTokenCount'), outputTokens: numeric('candidatesTokenCount'), thinkingTokens: numeric('thoughtsTokenCount'), totalTokens: numeric('totalTokenCount'),
        outputCharacters: candidate?.content?.parts?.filter(p => !p.thought).reduce((n, p) => n + (p.text?.length ?? 0), 0) ?? 0 });
      if (feedback?.blockReason || !candidate || candidate.finishReason !== 'STOP') throw new Failure('provider_refused_or_incomplete');
      text = candidate.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('') ?? '';
    } else {
      if (result.status !== 'completed') throw new Failure('provider_refused_or_incomplete');
      const output = result.output as { content?: { type?: string; text?: string }[] }[] | undefined;
      const content = output?.flatMap(item => item.content ?? []) ?? [];
      if (content.some(c => c.type === 'refusal')) throw new Failure('provider_refused_or_incomplete');
      text = content.filter(c => c.type === 'output_text').map(c => c.text ?? '').join('');
    }
    try { return JSON.parse(text); } catch { throw new Failure('invalid_provider_output'); }
  };
}
