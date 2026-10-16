import type { Config } from '../config.ts';
import { providerRoutes } from '../config.ts';
import type { Job } from '../storage/store.ts';

// Public, bounded messages only. Never expose raw provider diagnostics to the phone.
export function requestFeedback(config: Config, ready: boolean, job: Job | null | undefined, reason?: string | null) {
  const model = job ? providerRoutes(config)[job.provider_index]?.model : undefined;
  const retryAt = job?.next_at ? new Date(job.next_at).toISOString() : undefined;
  if (ready) return { code: 'ready', kind: 'success', message: 'Your saved library is up to date.' };
  if (job?.state === 'queued' || job?.state === 'running') {
    if (job.error === 'model_cooldown') return { code: 'model_cooldown', kind: 'error', retryAt,
      message: 'The available models are taking a break after errors. We’ll try again when their one-hour cooldown ends.' };
    if (job.error) return { code: 'fallback_pending', kind: 'error', model, retryAt,
      message: `The previous model could not respond. We’re switching to ${model ?? 'the next model'}.` };
    return { code: job.state, kind: 'info', model, retryAt,
      message: job.state === 'running' ? `Preparing new cards with ${model ?? 'Gemini'}…` : 'Your request is queued. We’ll notify you when new cards arrive.' };
  }
  const messages: Record<string, string> = {
    budget_exhausted: 'Your daily generation allowance is used up. Saved cards are still available.',
    quota_exhausted: 'The available models have reached their quota. Please try again later.',
    upstream_unavailable: 'The available models are busy right now. Please try again later.',
    upstream_timeout_or_network: 'The model took too long to respond. Refresh to try again; your saved cards are safe.',
    interrupted_request_requires_reconciliation: 'The last request was interrupted. Refresh to try again.',
    provider_credentials_or_access: 'Gemini could not authorize this request. The backend connection needs attention.',
    provider_configuration: 'The model could not accept this request. Please try again later.',
    provider_refused_or_incomplete: 'The model couldn’t finish this batch. Refresh to try again.',
    invalid_provider_output: 'The model returned a batch we couldn’t use. Refresh to try again.',
    duplicate_generation: 'That batch had no new ideas. Refresh to request another.',
    preparation_failed: 'We couldn’t prepare this batch. Please try again later.',
    input_budget_exceeded: 'This batch was too large to prepare. Please try again later.',
  };
  if (config.provider === 'disabled') return { code: 'disabled', kind: 'info', message: 'Generation is turned off. Your saved cards are available.' };
  return { code: reason ?? 'degraded', kind: 'error', message: messages[reason ?? ''] ?? 'We couldn’t complete your request. Please try again later.' };
}
