import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('responsive controls survive persisted Back/Forward, re-layout on return and clean up on final disposal',async()=>{
 const events=new Map(),changes=new Set(),toolbar={parent:'rail'},anchor={after(node){node.parent='rail';}},slot={className:'',append(node){node.parent='mobile';}},query={matches:true,addEventListener(type,fn){changes.add(fn);},removeEventListener(type,fn){changes.delete(fn);}};
 toolbar.before=()=>{};const rail={querySelector:()=>toolbar},stage={before:()=>{}};
 const context={document:{querySelector:selector=>selector==='.control-rail'?rail:stage,createComment:()=>anchor,createElement:()=>slot},matchMedia:()=>query,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);}};
 vm.runInNewContext(await readFile(new URL('../public/arcade-layout.mjs',import.meta.url),'utf8'),context);
 assert.equal(toolbar.parent,'mobile');assert.equal(changes.size,1);
 events.get('pagehide')({persisted:true});assert.equal(changes.size,1);
 query.matches=false;events.get('pageshow')({persisted:true});assert.equal(toolbar.parent,'rail');
 query.matches=true;for(const change of changes)change();assert.equal(toolbar.parent,'mobile');
 events.get('pagehide')({persisted:false});assert.equal(changes.size,0);assert.equal(events.has('pageshow'),false);
});
