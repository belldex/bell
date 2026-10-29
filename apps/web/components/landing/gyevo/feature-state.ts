/* Which BELL story is on screen, or none. One writer (feature-story.tsx),
   any number of readers (the navigation bar). A plain module store, so the two components never have to
   observe the page separately and can never disagree. */
export type FeatureId = "market-rhythm" | "risk-policy" | "planned-close";

let current: FeatureId | null = null;
const listeners = new Set<(feature: FeatureId | null) => void>();

export const getFeature = () => current;

export function setFeature(next: FeatureId | null) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener(next));
}

export function subscribeFeature(listener: (feature: FeatureId | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
