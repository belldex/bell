export function parseTaskCatalog(markdown) {
  const tasks = [];
  const seen = new Set();
  const heading = /^####\s+(M\d{2}-\d{2})\s+·\s+(.+?)\s*$/gm;
  for (const match of markdown.matchAll(heading)) {
    const [, id, title] = match;
    if (seen.has(id)) throw new Error(`Duplicate task ID in implementation plan: ${id}`);
    seen.add(id);
    tasks.push({ id, title });
  }
  return tasks;
}
