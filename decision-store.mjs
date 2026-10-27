// Private single-process durable aggregate ledger. A lifetime lock is never stolen.
import { open, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validOwnerAbandonment,validPredecessor } from './decision-recovery-contract.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const bad = code => { throw Object.assign(new Error(code), { code }); };
export async function openDecisionStore({ directory, lineage, policy, enroll = false, faultInjection, ownerRecovery } = {}) {
  if (faultInjection !== undefined && (typeof faultInjection !== 'function' || faultInjection.mode !== 'fixture')) bad('configuration');
  policy = structuredClone(policy);
  if(ownerRecovery!==undefined&&(!ownerRecovery||Object.keys(ownerRecovery).join(',')!=='expectedLedgerSHA256'||!/^[a-f0-9]{64}$/.test(ownerRecovery.expectedLedgerSHA256??'')||enroll||policy?.kind!=='risk-accepted-project-browser-policy-1'))bad('configuration');
  if (!path.isAbsolute(directory ?? '') || !/^[A-Za-z0-9_-]{1,80}$/.test(lineage ?? '')) bad('configuration');
  const sourceRoot = fileURLToPath(new URL('./', import.meta.url));
  if (directory === sourceRoot.slice(0,-1) || directory.startsWith(sourceRoot)) bad('unsafe_store');
  // Every existing ancestor must be a real directory; private leaf must belong to this owner.
  let at = path.parse(directory).root;
  for (const part of directory.slice(at.length).split('/').filter(Boolean)) {
    at = path.join(at, part);
    try { const s = await lstat(at); if (!s.isDirectory() || s.isSymbolicLink()) bad('unsafe_store'); }
    catch (e) { if (e.code !== 'ENOENT' || at !== directory || !enroll) throw e; await mkdir(at, { mode: 0o700 }); }
  }
  const dir = await lstat(directory);
  if (dir.uid !== process.getuid() || (dir.mode & 0o077)) bad('unsafe_store');
  const lockPath = path.join(directory, 'owner.lock'), file = path.join(directory, 'ledger.json');
  const lock = await open(lockPath, 'wx', 0o600); await lock.sync();
  let state, tail = Promise.resolve(), closed = false, broken = false;
  async function persist(next) {
    const temp = path.join(directory, `.ledger-${randomUUID()}`); let handle;
    try {
      await faultInjection?.('before-write', structuredClone(next));
      handle = await open(temp, 'wx', 0o600); await handle.writeFile(JSON.stringify(next)); await handle.sync(); await handle.close(); handle = null;
      await faultInjection?.('before-rename', structuredClone(next));
      await rename(temp, file);
      await faultInjection?.('after-rename', structuredClone(next)); const d = await open(directory, 'r'); try { await d.sync(); } finally { await d.close(); }
    } catch (e) { broken = true; throw Object.assign(new Error('store_unavailable'), {code:'store_unavailable'}); } finally { await handle?.close(); await unlink(temp).catch(() => {}); }
  }
  try {
    try {
      const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 16000000) bad('unsafe_store');
      const h = await open(file, 'r'); try { const bytes=await h.readFile();if(ownerRecovery&&createHash('sha256').update(bytes).digest('hex')!==ownerRecovery.expectedLedgerSHA256)bad('recovery_conflict');state = JSON.parse(bytes.toString('utf8')); } finally { await h.close(); }
    } catch (e) {
      if (e.code !== 'ENOENT' || !enroll) throw e;
      // Enrollment marker survives ledger removal: even explicit enrollment cannot refill a lost lineage.
      const marker = await open(path.join(directory, 'enrolled.json'), 'wx', 0o600);
      try { await marker.writeFile(JSON.stringify({lineage, policyDigest:digest(policy)})); await marker.sync(); } finally { await marker.close(); }
      state = { version: 1, lineage, policy, policyDigest: digest(policy), used: { attempts: 0, inputTokens: 0, estimatedMicros: 0 }, runs: {}, requests: {} }; await persist(state);
    }
    if (state.version !== 1 || state.lineage !== lineage || state.policyDigest !== digest(policy) || digest(state.policy) !== digest(policy) || !state.used || !state.runs || !state.requests || Object.values(state.requests).some(r => ['reserved','dispatch-intent'].includes(r.status)||(!ownerRecovery&&r.status==='uncertain')||r.deliveryPending===true)) bad('reconciliation_required');
    if (Object.keys(state.runs).length > policy.maxRuns || Object.keys(state.requests).length > Math.min(10000, policy.maxRuns * policy.maxEpochs * policy.maxPlacements)) bad('damaged_store');
    for (const [id,r] of Object.entries(state.runs)) if (r.id !== id || !/^[a-f0-9]{64}$/.test(r.capabilityDigest ?? '') || !Number.isInteger(r.epoch) || r.epoch < 0 || r.epoch >= policy.maxEpochs || !Number.isInteger(r.placements) || r.placements < 0 || r.placements > policy.maxPlacements || typeof r.closed !== 'boolean' || typeof r.terminal !== 'boolean' || typeof r.interrupted !== 'boolean' || r.expiresAt !== policy.expiresAt) bad('damaged_store');
    for (const [key,r] of Object.entries(state.requests)) if ((!['completed','rejected',...(ownerRecovery?['uncertain']:[])].includes(r.status)&&!validOwnerAbandonment(state,key,r,digest)) || !/^[a-f0-9]{64}$/.test(r.digest ?? '') || !state.runs[r.runId]) bad('damaged_store');
    for (const key of ['attempts','inputTokens','estimatedMicros']) if (!Number.isSafeInteger(state.used[key]) || state.used[key] < 0) bad('damaged_store');
    if(state.predecessor&&!validPredecessor(state))bad('damaged_store');
  } catch (e) { await lock.close(); await unlink(lockPath); throw e; }
  return Object.freeze({
    get sound() { return !broken && !closed; },
    fixtureOnly: faultInjection !== undefined,
    recoveryOnly: ownerRecovery !== undefined,
    snapshot: () => structuredClone(state),
    async inspect() { await tail; if (closed || broken) bad('store_unavailable'); return structuredClone(state); },
    transact(change) {
      const job = tail.then(async () => {
        if (closed || broken) bad('store_unavailable');
        const next = structuredClone(state), result = change(next); await persist(next); state = next; return result;
      }); tail = job.catch(() => {}); return job;
    },
    async close() { await tail; if (closed) return; closed = true; await lock.close(); await unlink(lockPath); },
  });
}
