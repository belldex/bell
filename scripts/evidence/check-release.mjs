import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { validateBaseline } from './validate-baseline.mjs';
import { parseTaskCatalog } from './task-catalog.mjs';
const allowedTaskStatuses = new Set(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED_ACCESS', 'BLOCKED_DEPENDENCY', 'IN_REVIEW', 'DONE']);

export function validateBriefIdentity(expected, actual) {
  if (expected !== actual) throw new Error('Brief SHA-256 does not match the release baseline');
  return true;
}

export function validateReleaseIndex(evidence, baseline) {
  if (evidence?.briefSha256 !== baseline?.briefSha256) {
    throw new Error('Release evidence index brief hash must match the baseline');
  }
  if (evidence?.implementationPlanSha256 !== baseline?.implementationPlanSha256) {
    throw new Error('Release evidence index implementation-plan hash must match the baseline');
  }
  if (!evidence.gates || typeof evidence.gates !== 'object') {
    throw new Error('Release evidence index is missing gate statuses');
  }
  for (const [id, status] of Object.entries(baseline.gates)) {
    if (evidence.gates[id] !== status) {
      throw new Error(`Release gate ${id} must match baseline until reviewed evidence updates both`);
    }
    if (status === 'PASS') {
      const paths = evidence.evidenceByGate?.[id];
      if (!Array.isArray(paths) || paths.length === 0) {
        throw new Error(`Release gate ${id} cannot PASS without hashed artifact evidence`);
      }
      for (const path of paths) {
        if (typeof path !== 'string' || !/^[a-f0-9]{64}$/i.test(evidence.artifactHashes?.[path] ?? '')) {
          throw new Error(`Release gate ${id} references an artifact without a SHA-256 hash`);
        }
      }
    }
  }
  return true;
}

export function validateTaskStatus(taskStatus, expectedTasks, expectedPlanHash) {
  const expectedCount = Array.isArray(expectedTasks) ? expectedTasks.length : expectedTasks;
  if (!Number.isInteger(expectedCount) || taskStatus?.planTaskCount !== expectedCount
    || Object.keys(taskStatus.tasks ?? {}).length !== expectedCount) {
    throw new Error(`Task status catalog must contain exactly ${expectedCount} plan tasks`);
  }
  if (taskStatus.implementationPlanSha256 !== expectedPlanHash) {
    throw new Error('Task status implementation-plan hash must match the baseline');
  }
  if (Array.isArray(expectedTasks)) {
    for (const { id, title } of expectedTasks) {
      if (taskStatus.tasks[id]?.title !== title) throw new Error(`Task status ID/title does not match the plan catalog: ${id}`);
    }
  }
  for (const [id, task] of Object.entries(taskStatus.tasks)) {
    if (!/^M\d{2}-\d{2}$/.test(id) || !allowedTaskStatuses.has(task?.status)) {
      throw new Error(`Task ${id} has an invalid ID or status`);
    }
    if (!Array.isArray(task.evidence) || !Array.isArray(task.blockers)) {
      throw new Error(`Task ${id} must contain evidence and blocker lists`);
    }
    if (task.status === 'DONE' && (task.evidence.length === 0 || task.blockers.length > 0)) {
      throw new Error(`Task ${id} cannot be DONE without evidence and no blockers`);
    }
    if (task.status.startsWith('BLOCKED_') && task.blockers.length === 0) {
      throw new Error(`Blocked task ${id} must explain its blocker`);
    }
  }
  return true;
}

export async function verifyReleaseArtifacts(evidence, readArtifact) {
  const paths = new Set();
  for (const [gate, status] of Object.entries(evidence?.gates ?? {})) {
    if (status !== 'PASS') continue;
    const references = evidence.evidenceByGate?.[gate];
    if (!Array.isArray(references) || references.length === 0) throw new Error(`PASS gate ${gate} has no artifact paths`);
    for (const artifactPath of references) paths.add(artifactPath);
  }
  for (const artifactPath of paths) {
    if (typeof artifactPath !== 'string' || artifactPath.length === 0 || artifactPath.includes('\\')
      || isAbsolute(artifactPath) || artifactPath.split('/').some((part) => part === '..' || part === '.' || part === '')) {
      throw new Error(`Invalid or unsafe release artifact path: ${artifactPath}`);
    }
    const expectedHash = evidence.artifactHashes?.[artifactPath];
    if (!/^[a-f0-9]{64}$/i.test(expectedHash ?? '')) throw new Error(`Release artifact ${artifactPath} has no valid SHA-256`);
    const bytes = await readArtifact(artifactPath);
    if (!(bytes instanceof Uint8Array)) throw new Error(`Release artifact ${artifactPath} did not return bytes`);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error(`Release artifact hash mismatch: ${artifactPath}`);
  }
  return true;
}

export async function readEvidenceArtifact(projectRoot, artifactPath) {
  if (typeof artifactPath !== 'string' || artifactPath.length === 0 || artifactPath.includes('\\')
    || isAbsolute(artifactPath) || artifactPath.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error(`Invalid or unsafe release artifact path: ${artifactPath}`);
  }
  const root = await realpath(projectRoot);
  const path = resolve(root, ...artifactPath.split('/'));
  const realArtifact = await realpath(path);
  const rel = relative(root, realArtifact);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('Release artifact resolves outside project root');
  const stats = await lstat(realArtifact);
  if (!stats.isFile()) throw new Error('Release artifact must be a regular file');
  return readFile(realArtifact);
}

async function main() {
  const baseline = JSON.parse(await readFile(new URL('../../config/release-baseline.json', import.meta.url), 'utf8'));
  const evidence = JSON.parse(await readFile(new URL('../../evidence/releases/index.json', import.meta.url), 'utf8'));
  const taskStatus = JSON.parse(await readFile(new URL('../../evidence/task-status.json', import.meta.url), 'utf8'));
  const brief = await readFile(new URL('../../BELL-Developer-Brief-Final.md', import.meta.url));
  const briefCopy = await readFile(new URL('../../docs/BELL-Developer-Brief-Final.md', import.meta.url));
  const plan = await readFile(new URL('../../BELL-Implementation-Plan-Final.md', import.meta.url));
  const planCopy = await readFile(new URL('../../docs/BELL-Implementation-Plan-Final.md', import.meta.url));
  const briefHash = createHash('sha256').update(brief).digest('hex');
  const briefCopyHash = createHash('sha256').update(briefCopy).digest('hex');
  const planHash = createHash('sha256').update(plan).digest('hex');
  const planCopyHash = createHash('sha256').update(planCopy).digest('hex');
  validateBaseline(baseline);
  validateBriefIdentity(baseline.briefSha256, briefHash);
  validateBriefIdentity(baseline.briefSha256, briefCopyHash);
  validateBriefIdentity(baseline.implementationPlanSha256, planHash);
  validateBriefIdentity(baseline.implementationPlanSha256, planCopyHash);
  validateReleaseIndex(evidence, baseline);
  validateTaskStatus(taskStatus, parseTaskCatalog(plan.toString('utf8')), planHash);
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  await verifyReleaseArtifacts(evidence, (artifactPath) => readEvidenceArtifact(projectRoot, artifactPath));
  const gateSummary = Object.entries(evidence.gates).map(([id, status]) => `${id}=${status}`).join(', ');
  console.log(`Release evidence structure valid; ${gateSummary}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
