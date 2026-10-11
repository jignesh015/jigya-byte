import { createHash } from 'node:crypto';
import { array, Failure, object, string, TOPICS } from '../contracts/index.ts';
import type { Card } from '../contracts/index.ts';
import type { Config } from '../config.ts';

export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export const normalize = (v: string) => v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const outputSchema = {
  type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['title', 'summary', 'explanation', 'primaryTopicId', 'topicIds'],
    properties: { title: { type: 'string', maxLength: 100 }, summary: { type: 'string', maxLength: 180 }, explanation: { type: 'string', maxLength: 700 },
      primaryTopicId: { type: 'string', enum: TOPICS }, topicIds: { type: 'array', items: { type: 'string', enum: TOPICS } } },
  } } },
};
export function prepare(raw: unknown, config: Config, expected: number): Card[] {
  const cards = array(object(raw).cards, expected);
  if (cards.length !== expected) throw new Failure('invalid_batch_size');
  return cards.map(value => {
    const c = object(value), title = string(c.title, 100), summary = string(c.summary, 180), explanation = string(c.explanation, 700);
    const primaryTopicId = string(c.primaryTopicId), topicIds = [...new Set(array(c.topicIds, 10).map(t => string(t)))];
    if (!TOPICS.includes(primaryTopicId) || !topicIds.includes(primaryTopicId) || topicIds.some(t => !TOPICS.includes(t))) throw new Failure('invalid_topic');
    const contentHash = hash(normalize(`${title}\n${summary}\n${explanation}`));
    return { id: `card-${contentHash}`, schemaVersion: 1, contentHash, ideaFingerprint: hash(normalize(title)), title, summary, explanation,
      primaryTopicId, topicIds, contentMode: 'ai-only', providerId: config.provider, modelId: config.model ?? 'fixture',
      promptVersion: '3', generatedAt: new Date().toISOString(), sources: [] };
  });
}
export function nearDuplicate(a: Card, b: Card): boolean {
  if (a.contentHash === b.contentHash || a.ideaFingerprint === b.ideaFingerprint) return true;
  const words = (v: string) => new Set(normalize(v).split(' ').filter(w => w.length > 2));
  const similarity = (x: Set<string>, y: Set<string>) => {
    const intersection = [...x].filter(w => y.has(w)).length;
    return intersection / Math.max(1, x.size + y.size - intersection);
  };
  return similarity(words(a.title), words(b.title)) >= 0.8 || similarity(words(a.summary), words(b.summary)) >= 0.85;
}
export function prompt(topics: string[], excludedTitles: string[]) {
  return `You write JigyaByte cards: quick, delightful discoveries for a curious adult, not classroom notes or research summaries.
Prepare exactly ${topics.length} distinct English cards, one for each topic in this order: ${JSON.stringify(topics)}. Return one JSON object matching the schema.

Every card must earn a “Wow, I didn't know that!” or “That makes me think” reaction. Prefer one specific, memorable fact, counterintuitive detail, surprising connection, vivid comparison, thoughtful question, or useful technique. For Game Design and Technology cards about game or software development, favor practical craft: a concrete technique, design lesson, debugging move, or production insight the reader can try. For every other subject, assume a curious non-specialist: use familiar words, avoid academic or research-paper tone, and explain any unavoidable term in a few words. Never use heavy jargon outside game development and software development.

Write a short, inviting title (<=100 characters), a single-sentence takeaway (<=180 characters), and a friendly explanation of 2–4 short sentences (250–600 characters, never more than 700). Lead with the interesting detail, then make clear why it happens or why it matters. Use one vivid example or comparison when it helps. Keep one central idea per card. Avoid encyclopedia openings, textbook definitions, lists, generic “did you know” openers, filler, and repeating the same point in different words.

You have no live reference material. Use only claims you are highly confident are true; prefer well-established facts over obscure trivia, never invent names, numbers, dates, quotes, or causal explanations to make a card more exciting, and do not present uncertainty as certainty. Cards are AI-generated and unverified, so do not claim that a fact was independently checked or cite URLs.

Avoid these previously seen ideas and titles: ${JSON.stringify(excludedTitles)}.`;
}
