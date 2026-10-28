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
  { id: 'literature', name: 'Literature', sortOrder: 10 },
  { id: 'tech-tips', name: 'Tech Tips', sortOrder: 11 },
  { id: 'game-industry-stories', name: 'Game Industry Stories', sortOrder: 12 },
  { id: 'ai-updates', name: 'AI Updates', sortOrder: 13 },
  { id: 'agentic-coding', name: 'Agentic Coding', sortOrder: 14 },
  { id: 'game-industry-news', name: 'Game Industry News', sortOrder: 15 },
  { id: 'indie-games', name: 'Indie Games', sortOrder: 16 },
  { id: 'current-affairs', name: 'Current Affairs', sortOrder: 17 },
  { id: 'general-knowledge', name: 'General Knowledge', sortOrder: 18 },
  { id: 'cinema', name: 'Cinema', sortOrder: 19 },
  { id: 'ancient-history', name: 'Ancient History', sortOrder: 20 },
  { id: 'indian-history', name: 'Indian History', sortOrder: 21 },
  { id: 'ancient-india', name: 'Ancient India', sortOrder: 22 },
  { id: 'indian-myths-and-epics', name: 'Indian Epics', sortOrder: 23 },
  { id: 'art', name: 'Art', sortOrder: 24 },
  { id: 'product-design', name: 'Product Design', sortOrder: 25 },
  { id: 'ux', name: 'UX', sortOrder: 26 },
];

export const topicColors: Record<string, string> = {
  'game-design': '#C6A0F6',
  science: '#66D8C7',
  history: '#E6A565',
  geography: '#78AAEF',
  space: '#A99AF8',
  economics: '#D9C46D',
  psychology: '#E98BA0',
  technology: '#66C8E3',
  philosophy: '#D69AC8',
  biology: '#A6D675',
  literature: '#E6B3CE',
  'tech-tips': '#73D9E6',
  'game-industry-stories': '#D5A6F2',
  'ai-updates': '#8AAFF5',
  'agentic-coding': '#7BD9B0',
  'game-industry-news': '#F0AD78',
  'indie-games': '#EACD78',
  'current-affairs': '#E9959E',
  'general-knowledge': '#B6D88A',
  cinema: '#DCA3E4',
  'ancient-history': '#D9B88C',
  'indian-history': '#EEAD77',
  'ancient-india': '#D7C185',
  'indian-myths-and-epics': '#C5A3E8',
  art: '#E99DB5',
  'product-design': '#85CFBC',
  ux: '#8FBDEC',
};

export function topicColor(topicId: string): string {
  return topicColors[topicId] ?? '#A1A7A3';
}

export async function contentHash(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

