import * as Crypto from 'expo-crypto';

export type Topic = {
  id: string;
  name: string;
  sortOrder: number;
};

export type ContentCard = {
  id: string;
  providerId: string;
  title: string;
  summary: string;
  explanation: string;
  primaryTopicId: string;
  topicIds: string[];
  sourceName: string;
  sourceUrl: string | null;
  attribution: string;
  license: string;
  licenseUrl: string | null;
  retrievedAt: string | null;
};

export const topics: Topic[] = [
  { id: 'game-design', name: 'Game Design', sortOrder: 0 },
  { id: 'science', name: 'Science', sortOrder: 1 },
  { id: 'history', name: 'History', sortOrder: 2 },
  { id: 'geography', name: 'Geography', sortOrder: 3 },
  { id: 'space', name: 'Space', sortOrder: 4 },
  { id: 'economics', name: 'Economics', sortOrder: 5 },
  { id: 'psychology', name: 'Psychology', sortOrder: 6 },
  { id: 'technology', name: 'Technology', sortOrder: 7 },
  { id: 'philosophy', name: 'Philosophy', sortOrder: 8 },
  { id: 'biology', name: 'Biology', sortOrder: 9 },
];

export async function contentHash(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

