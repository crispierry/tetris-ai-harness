import { localUrl } from './scaffold.mjs';
const [url, head, base, tree, operation_id] = process.argv.slice(2);
localUrl(url);
const response = await fetch(new URL('identity', url), { redirect:'error', signal:AbortSignal.timeout(3000) });
const observed = await response.json();
if (!response.ok || observed.url !== url || observed.head !== head || observed.base !== base || observed.tree !== tree || observed.operation_id !== operation_id || !Number.isSafeInteger(observed.pid) || observed.pid <= 1) throw Error('Actual local candidate identity mismatch');
console.log(JSON.stringify({ ...observed, kind:'health', passed:true, observed_at:new Date().toISOString() }));
