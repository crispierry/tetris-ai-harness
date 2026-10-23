export const mimeTypes = Object.freeze({ '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' });
const sha = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value ?? '');
export function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) <= 1023 || url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.href !== value) throw Error('Exact owned loopback root URL required');
  return url;
}
export function launchIdentity(env, pid) {
  const url = localUrl(env.BOB_LOCAL_URL);
  if (String(Number(env.BOB_LOCAL_PORT)) !== env.BOB_LOCAL_PORT || Number(env.BOB_LOCAL_PORT) !== Number(url.port) || !Number.isSafeInteger(pid) || pid <= 1 || ![env.BOB_LOCAL_HEAD,env.BOB_LOCAL_BASE,env.BOB_LOCAL_TREE].every(sha) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(env.BOB_LOCAL_OPERATION_ID ?? '')) throw Error('Actual local delivery candidate/process binding required');
  return Object.freeze({ url:url.href, head:env.BOB_LOCAL_HEAD, base:env.BOB_LOCAL_BASE, tree:env.BOB_LOCAL_TREE, operation_id:env.BOB_LOCAL_OPERATION_ID, pid });
}
export function assetPath(requestTarget) {
  if (typeof requestTarget !== 'string' || !requestTarget.startsWith('/')) return null;
  let pathname;
  try { pathname = decodeURIComponent(requestTarget.split('?')[0]); } catch { return null; }
  if (pathname === '/') return 'index.html';
  const parts = pathname.slice(1).split('/');
  if (!parts.length || parts.some(part => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) || part === '.' || part === '..') || pathname.includes('\\') || pathname.includes('\0')) return null;
  return parts.join('/');
}
