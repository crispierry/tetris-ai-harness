import test from 'node:test';
import assert from 'node:assert/strict';
import {mountComparison} from '../public/comparison-ui.mjs';
import {DEFAULT_CONFIG} from '../public/comparison.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await wait(2);}throw new Error('motion UI did not settle');}
test('actual mounted comparison holds commit metrics and renders descending poses until final reveal',async()=>{
 const nodes=new Map(),jobs=new Map();let serial=0;
 class E{constructor(){this.children=[];this.listeners={};this.value='';this.textContent='';}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){return this.listeners[k]?.({target:this});}}
 const $=id=>{if(id==='decision-pairing')return null;if(!nodes.has(id))nodes.set(id,new E());return nodes.get(id);};for(const [k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);$('c-right').value='local';
 const win={matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>{jobs.set(++serial,fn);return serial;},cancelAnimationFrame:id=>jobs.delete(id)},doc={getElementById:$,createElement:()=>new E(),addEventListener(){},hidden:false};const c=mountComparison(doc,{window:win});
 try{const step=$('c-step').trigger('click');await until(()=>c.view.lanes.every(l=>l.presentation?.phase==='placing'));assert(c.view.lanes.every(l=>l.pieces===1));assert.equal($('c-0-pieces').textContent,'0');assert.equal($('c-0-status').textContent,'Placing…');const exported=c.exportRun(),rows=[];
  for(const now of [0,80,160,240,320,400]){const active=[...jobs.values()];jobs.clear();active.forEach(fn=>fn(now));const indexes=$('c-0-board').children.flatMap((e,i)=>e.className?.includes(' active')?[Math.floor(i/10)]:[]);if(indexes.length)rows.push(Math.min(...indexes));await Promise.resolve();}
  await step;assert(new Set(rows).size>=3);assert.equal($('c-0-pieces').textContent,'1');assert.equal($('c-0-status').textContent,'Paused');assert.equal(c.exportRun(),exported);assert.equal(jobs.size,0);
 }finally{c.dispose();}
});
