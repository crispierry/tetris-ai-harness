import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('failed HTTP binding releases the fixture ledger so the same lineage can restart', {timeout:10000}, async t => {
 const directory=await mkdtemp(path.join(await realpath(os.tmpdir()),'tetris-startup-'));
 const occupied=http.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 const port=occupied.address().port, url=`http://127.0.0.1:${port}/`;
 const env={...process.env,BOB_LOCAL_URL:url,BOB_LOCAL_PORT:String(port),BOB_LOCAL_HEAD:'a'.repeat(40),BOB_LOCAL_BASE:'b'.repeat(40),BOB_LOCAL_TREE:'c'.repeat(40),BOB_LOCAL_OPERATION_ID:randomUUID(),BOB_DECISION_FIXTURE_LEDGER:path.join(directory,'ledger'),BOB_DECISION_FIXTURE_EXPIRES:String(Date.now()+60000)};
 const children=[];
 function start(enroll) {
  const child=spawn(process.execPath,['server.mjs','--decision-fixture-owner',...(enroll?['--enroll-decision-fixture']:[])],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,stdio:['pipe','ignore','pipe']});
  children.push(child);let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stderr}));});
  return {child,done};
 }
 t.after(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await new Promise(resolve=>occupied.close(resolve));await rm(directory,{recursive:true,force:true});});
 const failed=await start(true).done;assert.equal(failed.code,1);assert.match(failed.stderr,/EADDRINUSE/);
 const lock=path.join(env.BOB_DECISION_FIXTURE_LEDGER,'owner.lock');
 await assert.rejects(access(lock),{code:'ENOENT'});
 await new Promise(resolve=>occupied.close(resolve));
 const retry=start(false);
 const ready=(async()=>{for(let i=0;i<100;i++){
  assert.equal(retry.child.exitCode,null,'Restart exited before becoming ready');
  try {const response=await fetch(new URL('identity',url),{signal:AbortSignal.timeout(500)});if(response.ok){assert.equal((await response.json()).pid,retry.child.pid);return;}}catch(error){if(error.code==='ERR_ASSERTION')throw error;}
  await new Promise(resolve=>setTimeout(resolve,10));
 }assert.fail('Restart did not become ready');})();
 await ready;retry.child.kill('SIGTERM');assert.equal((await retry.done).code,0);
 await assert.rejects(access(lock),{code:'ENOENT'});
});
