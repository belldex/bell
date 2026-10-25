import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseTaskCatalog } from './task-catalog.mjs';

const planPath = new URL('../../docs/BELL-Implementation-Plan-Final.md', import.meta.url);
const statusPath = new URL('../../evidence/task-status.json', import.meta.url);
const allowedStatuses = new Set(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED_ACCESS', 'BLOCKED_DEPENDENCY', 'IN_REVIEW', 'DONE']);

export function mergeTaskStatus(catalog, previous, updates = {}) {
  const knownIds = new Set(catalog.map(({ id }) => id));
  for (const [id, update] of Object.entries(updates)) {
    if (!knownIds.has(id)) throw new Error(`Unknown implementation-plan task ID: ${id}`);
    if (update.status && !allowedStatuses.has(update.status)) throw new Error(`Invalid task status for ${id}`);
  }
  const tasks = Object.fromEntries(catalog.map(({ id, title }) => {
    const old = previous.tasks?.[id] ?? {};
    const update = updates[id] ?? {};
    const status = update.status ?? (allowedStatuses.has(old.status) ? old.status : 'NOT_STARTED');
    return [id, {
      title,
      status,
      evidence: update.evidence ?? old.evidence ?? [],
      blockers: update.blockers ?? old.blockers ?? [],
    }];
  }));
  return tasks;
}

export async function syncTaskStatus(updates = {}) {
  const plan = await readFile(planPath, 'utf8');
  const baselineText = await readFile(new URL('../../config/release-baseline.json', import.meta.url), 'utf8');
  const { briefSha256, implementationPlanSha256 } = JSON.parse(baselineText);
  const catalog = parseTaskCatalog(plan);
  let previous = { tasks: {} };
  try {
    previous = JSON.parse(await readFile(statusPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const tasks = mergeTaskStatus(catalog, previous, updates);
  const result = { schemaVersion: 1, planTaskCount: catalog.length, briefSha256, implementationPlanSha256, tasks };
  await writeFile(statusPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const updates = {};
  for (const arg of process.argv.slice(2)) {
    const [kind, rest] = arg.split('=', 2);
    if (!rest) throw new Error(`Expected --set=TASK:STATUS or --blocker=TASK:REASON, got ${arg}`);
    const separator = rest.indexOf(':');
    if (separator < 1) throw new Error(`Malformed task update: ${arg}`);
    const id = rest.slice(0, separator);
    const value = rest.slice(separator + 1);
    updates[id] ??= {};
    if (kind === '--set') updates[id].status = value;
    else if (kind === '--blocker') updates[id].blockers = [...(updates[id].blockers ?? []), value];
    else if (kind === '--evidence') updates[id].evidence = [...(updates[id].evidence ?? []), value];
    else throw new Error(`Unsupported task update argument: ${arg}`);
  }
  const result = await syncTaskStatus(updates);
  console.log(`Synchronized ${result.planTaskCount} task statuses from the implementation plan.`);
}
