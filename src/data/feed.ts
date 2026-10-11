import type { Card, FeedLane } from './database';

export type FeedAssignment = {
  cardId: string;
  lane: FeedLane;
  requestedLane: FeedLane;
  rank?: number;
};

const laneBlock: FeedLane[] = [
  'discovery', 'discovery', 'discovery', 'discovery', 'discovery', 'discovery', 'discovery',
  'interest', 'interest', 'review',
];

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function buildFeedSchedule(
  cards: Card[],
  interestTopicIds: string[],
  recentlyShownIds: string[],
  now = new Date(),
): FeedAssignment[] {
  if (cards.length === 0) return [];

  const recent = new Set(recentlyShownIds);
  const unseenRecently = cards.filter((card) => !recent.has(card.id));
  // Cycle back through the library only after this device has exhausted its unseen pool.
  const candidates = shuffled(unseenRecently.length > 0 ? unseenRecently : cards);
  const remaining = [...candidates];
  const selectedHashes = new Set<string>();
  const byRequestedLane: Record<FeedLane, FeedAssignment[]> = {
    discovery: [], interest: [], review: [],
  };

  const take = (requestedLane: FeedLane, predicate: (card: Card) => boolean): boolean => {
    const index = remaining.findIndex((card) => !selectedHashes.has(card.contentHash) && predicate(card));
    if (index < 0) return false;
    const [card] = remaining.splice(index, 1);
    selectedHashes.add(card.contentHash);
    byRequestedLane[requestedLane].push({ cardId: card.id, lane: requestedLane, requestedLane });
    return true;
  };

  const dueAt = now.getTime();
  const interests = new Set(interestTopicIds);
  const reviewSlots = laneBlock.filter((lane) => lane === 'review').length;
  const interestSlots = laneBlock.filter((lane) => lane === 'interest').length;
  const discoverySlots = laneBlock.filter((lane) => lane === 'discovery').length;

  for (let slot = 0; slot < reviewSlots; slot += 1) {
    take('review', (card) => card.nextReviewAt !== null && Date.parse(card.nextReviewAt) <= dueAt);
  }
  const coveredInterestTopics = new Set<string>();
  for (let slot = 0; slot < interestSlots; slot += 1) {
    const freshTopics = new Set(remaining
      .filter((card) => !selectedHashes.has(card.contentHash))
      .flatMap((card) => card.topicIds)
      .filter((topicId) => interests.has(topicId) && !coveredInterestTopics.has(topicId)));
    const selected = take('interest', (card) => !card.isRead && card.topicIds.some((topicId) => interests.has(topicId)
      && (freshTopics.size === 0 || freshTopics.has(topicId))));
    if (selected) {
      const assignment = byRequestedLane.interest[byRequestedLane.interest.length - 1];
      const selectedCard = candidates.find((card) => card.id === assignment.cardId);
      selectedCard?.topicIds.forEach((topicId) => {
        if (interests.has(topicId)) coveredInterestTopics.add(topicId);
      });
    }
  }
  for (let slot = 0; slot < discoverySlots; slot += 1) {
    take('discovery', (card) => !card.isRead);
  }

  // Empty interest and review slots draw from discovery while keeping the requested slot visible.
  const requestedCounts: Record<FeedLane, number> = {
    discovery: discoverySlots, interest: interestSlots, review: reviewSlots,
  };
  for (const requestedLane of ['review', 'interest', 'discovery'] as FeedLane[]) {
    while (byRequestedLane[requestedLane].length < requestedCounts[requestedLane]) {
      const card = remaining.find((item) => !item.isRead && !selectedHashes.has(item.contentHash));
      if (!card) break;
      remaining.splice(remaining.indexOf(card), 1);
      selectedHashes.add(card.contentHash);
      byRequestedLane[requestedLane].push({
        cardId: card.id,
        lane: 'discovery',
        requestedLane,
      });
    }
  }

  const slots = shuffled(laneBlock);
  const used = new Set<string>();
  const schedule: FeedAssignment[] = [];
  for (const requestedLane of slots) {
    const assignment = byRequestedLane[requestedLane].shift();
    if (assignment && !used.has(assignment.cardId)) {
      used.add(assignment.cardId);
      schedule.push(assignment);
    }
  }

  return schedule;
}
