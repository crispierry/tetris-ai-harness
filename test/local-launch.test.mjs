import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {localEnvironment} from '../local-launch.mjs';

test('local launcher snapshots actual working source, excludes ignored credentials and preserves the real index',t=>{
 const cwd=mkdtempSync(path.join(os.tmpdir(),'tetris-launch-test-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 writeFileSync(path.join(cwd,'.gitignore'),'.env\n');writeFileSync(path.join(cwd,'source.txt'),'original');git('add','.');git('commit','-m','fixture');
 writeFileSync(path.join(cwd,'source.txt'),'working');writeFileSync(path.join(cwd,'new.txt'),'new');writeFileSync(path.join(cwd,'.env'),'SYNTHETIC_PRIVATE_DATA');
 const index=readFileSync(path.join(cwd,'.git/index'));
 const env=localEnvironment({cwd,port:'4410',env:{...process.env,GIT_DIR:'/invalid',GIT_INDEX_FILE:'/invalid',OPENAI_API_KEY:'dummy_unused'}});
 assert.equal(env.BOB_LOCAL_URL,'http://127.0.0.1:4410/');assert.equal(env.BOB_LOCAL_HEAD,git('rev-parse','HEAD'));
 assert.notEqual(env.BOB_LOCAL_TREE,git('rev-parse','HEAD^{tree}'));
 assert.equal(git('show',`${env.BOB_LOCAL_TREE}:source.txt`),'working');assert.equal(git('show',`${env.BOB_LOCAL_TREE}:new.txt`),'new');
 assert.throws(()=>git('show',`${env.BOB_LOCAL_TREE}:.env`));assert.deepEqual(readFileSync(path.join(cwd,'.git/index')),index);
 assert.notEqual(localEnvironment({cwd}).BOB_LOCAL_OPERATION_ID,env.BOB_LOCAL_OPERATION_ID);
});

test('local launcher rejects invalid ports and never fabricates an identity outside a Git clone',t=>{
 for(const port of ['80','04407','65536','4407x','http://host',NaN])assert.throws(()=>localEnvironment({port}),/PORT must/);
 const cwd=mkdtempSync(path.join(os.tmpdir(),'tetris-no-git-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 assert.throws(()=>localEnvironment({cwd}));
});
