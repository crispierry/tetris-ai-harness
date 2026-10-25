import http from 'node:http';
import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assetPath, launchIdentity, mimeTypes } from './scaffold.mjs';
import { createDecisionService } from './decision-service.mjs';
import { createDecisionHandler } from './decision-http.mjs';
// Owner bootstrap is intentionally absent: ordinary launch cannot enroll or spend.
const decisions = createDecisionService();
const decisionHandler = createDecisionHandler({ service: decisions, host: `127.0.0.1:${Number(process.env.BOB_LOCAL_PORT)}`, origin: `http://127.0.0.1:${Number(process.env.BOB_LOCAL_PORT)}` });
const identity = launchIdentity(process.env, process.pid);
const root = fileURLToPath(new URL('./public/', import.meta.url));
async function asset(relative) {
  let current = root;
  const parent = await lstat(current);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error('Static root unavailable');
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const item = await lstat(current);
    if (item.isSymbolicLink() || index < parts.length - 1 && !item.isDirectory() || index === parts.length - 1 && (!item.isFile() || item.size > 1048576)) throw Error('Static asset unavailable');
  }
  return readFile(current);
}
http.createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('content-security-policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (await decisionHandler(request, response)) return;
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  if (request.url === '/identity') {
    response.setHeader('content-type', 'application/json');
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(identity)); return;
  }
  const relative = assetPath(request.url), mime = relative && mimeTypes[path.extname(relative)];
  if (!mime) { response.writeHead(404); response.end(); return; }
  try { const bytes = await asset(relative); response.setHeader('content-type', mime); response.end(request.method === 'HEAD' ? undefined : bytes); }
  catch { response.writeHead(404); response.end(); }
}).listen(Number(process.env.BOB_LOCAL_PORT), '127.0.0.1');
