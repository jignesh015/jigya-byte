import type { Config } from '../config.ts';

export const MODEL_COOLDOWN_MS = 60 * 60 * 1000;
export type ModelCooldown = { provider: string; model: string; failed_at: number; reason: string };
export function availableRoute(routes: Config[], cooldowns: ModelCooldown[], start = 0, now = Date.now()) {
  return routes.findIndex((route, index) => index >= start && !cooldowns.some(c =>
    c.provider === route.provider && c.model === route.model && c.failed_at + MODEL_COOLDOWN_MS > now));
}
export function cooldownEnds(routes: Config[], cooldowns: ModelCooldown[], now = Date.now()) {
  const ends = cooldowns.filter(c => routes.some(r => r.provider === c.provider && r.model === c.model))
    .map(c => c.failed_at + MODEL_COOLDOWN_MS).filter(end => end > now);
  return ends.length ? Math.min(...ends) : now;
}
