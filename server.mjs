import { decisionStartupMode, bootstrapLiveDecisionService } from './decision-bootstrap.mjs';
import http from 'node:http';
import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assetPath, launchIdentity, mimeTypes } from './scaffold.mjs';
import { createDecisionService } from './decision-service.mjs';
import { createDecisionHandler } from './decision-http.mjs';
import { openDecisionStore } from './decision-store.mjs';
import { createDecisionOwner, attachOwnerInput } from './decision-owner.mjs';
const startup = decisionStartupMode(process.argv.slice(2));
const identity = launchIdentity(process.env, process.pid);
// Explicit fixture-only OS-owner bootstrap. Provider key presence is never inspected.
let decisions=createDecisionService(), owner=null, detachOwner=null;
if(startup.mode === 'fixture') {
  const directory=process.env.BOB_DECISION_FIXTURE_LEDGER;
  const policy={maxAttempts:1000,maxInputTokens:1049600000,maxEstimatedMicros:1000000,expiresAt:Number(process.env.BOB_DECISION_FIXTURE_EXPIRES),maxRuns:8,maxEpochs:100,maxPlacements:1000,timeoutMs:1500,reservationTokens:1049600,reservationMicros:1000};
  const store=await openDecisionStore({directory,lineage:'p8-020-offline-fixture',policy,enroll:process.argv.includes('--enroll-decision-fixture')});
  const transport=Object.assign(async request=>{const ids=request.body.questions[0].choices.map(c=>c.value);return {status:200,body:{model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:ids[0],confidence:1,probabilities:ids.map((value,i)=>({value,probability:i?0:1}))}]}};},{mode:'fixture'});
  decisions=createDecisionService({enabled:true,store,policy,transport});owner=createDecisionOwner({service:decisions});
  detachOwner=attachOwnerInput(process.stdin,owner,value=>process.stdout.write(JSON.stringify(value)+'\n'));
}
if (startup.mode === 'live') {
  decisions = await bootstrapLiveDecisionService({ args: process.argv.slice(2) });
  owner = createDecisionOwner({ service: decisions });
  detachOwner = attachOwnerInput(process.stdin, owner, value => process.stdout.write(JSON.stringify(value) + '\n'));
}
const decisionHandler = createDecisionHandler({ service: decisions, owner, host: `127.0.0.1:${Number(process.env.BOB_LOCAL_PORT)}`, origin: `http://127.0.0.1:${Number(process.env.BOB_LOCAL_PORT)}` });
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
const server=http.createServer(async (request, response) => {
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

let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;try{await detachOwner?.();await owner?.close();await decisions.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));process.stdin.pause();}catch{process.stderr.write('decision_shutdown_drain_failed\n');process.exitCode=1;}}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
