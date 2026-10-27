import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { qualifiedDecisions } from './decision-qualification.mjs';
import { openDecisionStore } from './decision-store.mjs';
import { createDecisionService } from './decision-service.mjs';
export const DEFAULT_DECISION_KEY_FILE = path.join(homedir(), '.config/tetris-ai-harness/openai.env');
const reject = () => { throw Object.assign(new Error('decision_live_startup_rejected'), { code: 'decision_live_startup_rejected' }); };
const same = (a,b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
export async function readPrivateOwnerFile(file, maxBytes) {
  let directory, handle, bytes;
  try {
    if (!path.isAbsolute(file ?? '') || !Number.isSafeInteger(maxBytes) || maxBytes < 1) reject();
    let at = path.parse(file).root;
    for (const part of path.dirname(file).slice(at.length).split('/').filter(Boolean)) {
      at = path.join(at, part); const stat = await lstat(at);
      if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
    }
    const parent = await lstat(path.dirname(file)), before = await lstat(file);
    if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o7777) !== 0o700 ||
        !before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid() || (before.mode & 0o7777) !== 0o600 || before.nlink !== 1 || before.size < 1 || before.size > maxBytes) reject();
    directory = await open(path.dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!same(parent, await directory.stat())) reject();
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!same(before, await handle.stat()) || !same(parent, await lstat(path.dirname(file)))) reject();
    bytes = Buffer.alloc(maxBytes + 1); const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== before.size || result.bytesRead > maxBytes || !same(before, await handle.stat()) || !same(before, await lstat(file)) || !same(parent, await lstat(path.dirname(file)))) reject();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, result.bytesRead));
  } catch { reject(); } finally {
    bytes?.fill(0);
    const closed = await Promise.allSettled([handle?.close(), directory?.close()]);
    if (closed.some(result => result.status === 'rejected')) reject();
  }
}
export function parseDecisionCredential(text) {
  const match = typeof text === 'string' && /^OPENAI_API_KEY=([A-Za-z0-9_-]{16,512})\n?$/.exec(text);
  if (!match) reject(); return match[1];
}
export async function readDecisionCredential({ file = DEFAULT_DECISION_KEY_FILE } = {}) {
  return parseDecisionCredential(await readPrivateOwnerFile(file, 1024));
}
export function decisionStartupMode(args) {
  const flags = args.filter(a => a.startsWith('--decision-') || a.startsWith('--enroll-decision-'));
  const known = a => ['--decision-fixture-owner','--enroll-decision-fixture','--decision-live-owner','--enroll-decision-live','--decision-browser-owner','--enroll-decision-browser'].includes(a) || a.startsWith('--decision-live-config=') || a.startsWith('--decision-browser-config=');
  if (flags.some(a => !known(a)) || new Set(flags.map(a => a.split('=')[0])).size !== flags.length) reject();
  const fixture=flags.includes('--decision-fixture-owner'),live=flags.includes('--decision-live-owner'),browser=flags.includes('--decision-browser-owner');
  const config=flags.find(a=>a.startsWith(browser?'--decision-browser-config=':'--decision-live-config='))?.split('=').slice(1).join('=');
  if([fixture,live,browser].filter(Boolean).length>1||flags.some(a=>a.includes('browser')&&!browser)||flags.some(a=>a.includes('live')&&!live)||flags.includes('--enroll-decision-fixture')&&!fixture||((live||browser)&&!config))reject();
  return {mode:browser?'browser':live?'live':fixture?'fixture':'off',config,enroll:flags.includes(browser?'--enroll-decision-browser':'--enroll-decision-live')};
}
// Injectable loaders are for disposable dummy fixtures only. The production
// entrypoint supplies none and cannot override the fixed credential location.
export async function bootstrapLiveDecisionService({ args, readConfig = async file => JSON.parse(await readPrivateOwnerFile(file, 65536)), loadCredential = readDecisionCredential, openStore = openDecisionStore } = {}) {
  let store;
  try {
    const startup = decisionStartupMode(args ?? []);
    if (startup.mode !== 'live') return null;
    const c = await readConfig(startup.config);
    if (!c || Object.keys(c).sort().join(',') !== 'directory,lineage,policy,qualification' || !path.isAbsolute(c.directory ?? '') || !/^[A-Za-z0-9_-]{1,80}$/.test(c.lineage ?? '') || !qualifiedDecisions(c.qualification, c.policy)) reject();
    // Validate the exact immutable policy and private durable store before any
    // credential read. Existing enrollment/reconciliation rules remain intact.
    store = await openStore({ directory: c.directory, lineage: c.lineage, policy: c.policy, enroll: startup.enroll });
    const preview = createDecisionService({ enabled: true, store, policy: c.policy, qualification: c.qualification, credential: 'configuration-check-only' });
    if (!preview.status().available) reject();
    const credential = await loadCredential();
    const service = createDecisionService({ enabled: true, store, policy: c.policy, qualification: c.qualification, credential });
    if (!service.status().available) reject();
    return service;
  } catch { try { await store?.close(); } catch { reject(); } reject(); }
}
