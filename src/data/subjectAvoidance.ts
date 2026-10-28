// Shared by the phone and both backends. No card bodies or model calls in this path.
export type AvoidedSubject = { subject: string; topicIds: string[] };
type SubjectCard = { subject?: string | null; title: string; summary: string };
export const normalizeSubject = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function cardSubject(card: SubjectCard): string {
  // Old cards have no canonical label. Their title + single-sentence takeaway is
  // the smallest available description that preserves the actual idea.
  return normalizeSubject(card.subject || `${card.title} ${card.summary}`).slice(0, 280).trim();
}

const stop = new Set('a an the is are was were be being been of on in at to for from and or with by that this it its how why your you can'.split(' '));
const words = (value: string) => new Set(normalizeSubject(value).split(' ').filter(w => w.length > 2 && !stop.has(w)));

export function avoidsCard(card: SubjectCard, avoided: AvoidedSubject[]): boolean {
  const subject = cardSubject(card), specific = words(subject), text = words(`${card.title} ${card.summary}`);
  return avoided.some(entry => {
    const blocked = normalizeSubject(entry.subject);
    if (subject === blocked) return true;
    const terms = words(blocked);
    if (terms.size < 3) return false;
    const overlap = (other: Set<string>) => [...terms].filter(w => other.has(w)).length;
    // Conservative lexical backstop; semantic paraphrases are also forbidden
    // in the generation prompt. Never equate a topic tag with a subject.
    return overlap(specific) / Math.max(terms.size, specific.size) >= 0.85
      || overlap(text) === terms.size;
  });
}
