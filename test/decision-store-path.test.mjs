import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('private ledgers cannot enter the source tree through a dot-segment path alias',async t=>{
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'tetris-store-path-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),leaf=path.join(source,'private-ledger');
 await mkdir(source,{mode:0o700});await mkdir(leaf,{mode:0o700});
 for(const file of ['decision-store.mjs','decision-recovery-contract.mjs'])await copyFile(new URL('../'+file,import.meta.url),path.join(source,file));
 const {openDecisionStore}=await import(pathToFileURL(path.join(source,'decision-store.mjs')));
 const policy={maxRuns:1,maxEpochs:1,maxPlacements:1};
 for(const directory of [leaf,root+'/./source/private-ledger',root+'/source/../source/private-ledger']){
  let store;try{await assert.rejects(async()=>{store=await openDecisionStore({directory,lineage:'dummy-path',policy,enroll:true});},{code:'unsafe_store'});}finally{await store?.close();}
 }
});
