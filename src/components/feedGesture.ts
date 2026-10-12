// Distances are React Native layout units. Three units clear touch jitter while
// accepting short, slow swipes as well as flicks, independent of page height.
export function feedSwipeTarget(startIndex: number, lastIndex: number, deltaY: number): number {
  const direction = deltaY <= -3 ? 1 : deltaY >= 3 ? -1 : 0;
  return Math.max(0, Math.min(lastIndex, startIndex + direction));
}
