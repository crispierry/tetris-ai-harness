import test from 'node:test';
import assert from 'node:assert/strict';
import { assetPath, launchIdentity, localUrl } from '../scaffold.mjs';
const env = { BOB_LOCAL_URL:'http://127.0.0.1:43210/', BOB_LOCAL_PORT:'43210', BOB_LOCAL_HEAD:'a'.repeat(40), BOB_LOCAL_BASE:'b'.repeat(40), BOB_LOCAL_TREE:'c'.repeat(40), BOB_LOCAL_OPERATION_ID:'00000000-0000-4000-8000-000000000001' };
test('owned local identity binds exact candidate and actual serving PID without game assertions', () => {
  assert.deepEqual(launchIdentity(env, 4242), { url:env.BOB_LOCAL_URL, head:env.BOB_LOCAL_HEAD, base:env.BOB_LOCAL_BASE, tree:env.BOB_LOCAL_TREE, operation_id:env.BOB_LOCAL_OPERATION_ID, pid:4242 });
});
test('missing or inconsistent host binding cannot start a neutral server', () => {
  for (const change of [{BOB_LOCAL_PORT:'43211'},{BOB_LOCAL_HEAD:''},{BOB_LOCAL_OPERATION_ID:''},{BOB_LOCAL_URL:'http://example.com:43210/'}]) assert.throws(() => launchIdentity({...env,...change},4242));
  assert.throws(() => launchIdentity(env,1));
});
test('static request mapping remains inside the explicit public asset tree', () => {
  assert.equal(assetPath('/'),'index.html');assert.equal(assetPath('/src/app.mjs?v=1'),'src/app.mjs');
  for (const target of ['/../package.json','/%2e%2e/package.json','/.git/config','//host/file.js','/x/../../a.js','/a%00.js','/a%5cb.js','/%zz']) assert.equal(assetPath(target),null,target);
});
test('health target refuses credentials, queries, missing ports and remote or aliased hosts', () => {
  assert.equal(localUrl(env.BOB_LOCAL_URL).port,'43210');
  for (const target of ['http://127.0.0.1/','http://localhost:43210/','https://127.0.0.1:43210/','http://user@127.0.0.1:43210/','http://127.0.0.1:43210/?x=1']) assert.throws(() => localUrl(target));
});
