import { randomInt } from 'node:crypto';

// Random tie-breaking among least-generated topics gives equal coverage without a fixed order.
export function distributedTopics(pool: string[], amount: number, counts: Record<string, number>, random = (max: number) => randomInt(max)): string[] {
  const totals = { ...counts }; const result: string[] = [];
  if (!pool.length) return result;
  for (let i = 0; i < amount; i++) {
    const minimum = Math.min(...pool.map(topic => totals[topic] ?? 0));
    const eligible = pool.filter(topic => (totals[topic] ?? 0) === minimum);
    const topic = eligible[random(eligible.length)]; result.push(topic); totals[topic] = (totals[topic] ?? 0) + 1;
  }
  return result;
}
