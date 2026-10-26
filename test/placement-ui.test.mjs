import test from 'node:test';
import assert from 'node:assert/strict';
import {mountVersus} from '../public/versus-ui.mjs';
import {mountHarness} from '../public/harness-ui.mjs';
import {heuristic} from '../public/controller.mjs';
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


test('mounted solo replay holds the complete prior view until its second placement settles',async()=>{
 const nodes=new Map(),jobs=new Map();let serial=0,reduced=true,calls=0;
 class E{constructor(){this.children=[];this.listeners={};this.value='local';this.textContent='';}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){return this.listeners[k]?.({target:this});}}
 const $=id=>{if(id==='decision-pairing')return null;if(!nodes.has(id))nodes.set(id,new E());return nodes.get(id);},win={addEventListener(){},matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{jobs.set(++serial,fn);return serial;},cancelAnimationFrame:id=>jobs.delete(id)},doc={getElementById:$,createElement:()=>new E(),addEventListener(){},hidden:false},mounted=mountHarness(doc,{window:win}),base=heuristic();mounted.controller.setProvider({...base,async decide(packet){calls++;return base.decide(packet);}});
 try{
  await $('h-step').trigger('click');await $('h-step').trigger('click');assert.equal(calls,2);const json=mounted.exportRun();$('h-replay').trigger('click');assert.equal($('h-pieces').textContent,'1');const previous={score:$('h-score').textContent,lines:$('h-lines').textContent,level:$('h-level').textContent,choice:$('h-choice').textContent,details:$('h-details').textContent};reduced=false;
  const replay=$('h-step').trigger('click');assert.equal($('h-status').textContent,'Saved visual replay');assert.equal($('h-pieces').textContent,'1');const rows=[];
  for(const now of [0,80,160,240,320]){const frames=[...jobs.values()];jobs.clear();frames.forEach(fn=>fn(now));const active=$('h-board').children.flatMap((e,i)=>e.className?.includes(' active')?[Math.floor(i/10)]:[]);if(active.length)rows.push(Math.min(...active));assert.equal($('h-pieces').textContent,'1');for(const k of ['score','lines','level','choice','details'])assert.equal($('h-'+k).textContent,previous[k]);assert.equal($('h-board').children.filter(e=>e.className?.includes(' filled')&&!e.className.includes(' active')).length,4);assert.equal(mounted.exportRun(),json);await Promise.resolve();}
  const frames=[...jobs.values()];jobs.clear();frames.forEach(fn=>fn(400));await replay;assert(new Set(rows).size>=3);assert.equal($('h-pieces').textContent,'2');assert.notEqual($('h-choice').textContent,previous.choice);assert.equal($('h-status').textContent,'Saved visual replay');assert.equal($('h-board').children.filter(e=>e.className?.includes(' filled')&&!e.className.includes(' active')).length,8);assert.equal(mounted.exportRun(),json);assert.equal(calls,2);assert.equal(jobs.size,0);
 }finally{mounted.dispose();}
});


test('mounted versus progress holds the algorithm count while independent human input advances',async()=>{
 const nodes=new Map(),jobs=new Map();let serial=0;const doc={activeElement:null,hasFocus:()=>true,addEventListener(){},hidden:false};
 class E{constructor(){this.children=[];this.listeners={};this.value='local';this.textContent='';}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k,e={}){return this.listeners[k]?.(e);}focus(){doc.activeElement=this;}}
 const $=id=>{if(id==='decision-pairing')return null;if(!nodes.has(id))nodes.set(id,new E());return nodes.get(id);};doc.getElementById=$;doc.createElement=()=>new E();const win={addEventListener(){},matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>{jobs.set(++serial,fn);return serial;},cancelAnimationFrame:id=>jobs.delete(id)},mounted=mountVersus(doc,{window:win});
 try{await $('v-start').trigger('click');await until(()=>mounted.runner.view.lanes[1].presentation?.phase==='placing');assert.equal(mounted.runner.view.lanes[1].pieces,1);assert.equal($('v-1-pieces').textContent,'0');assert.match($('v-progress').textContent,/Human 0\/1000 pieces · Algorithm 0\/1000 pieces/);
  $('v-human-game').trigger('keydown',{key:' ',repeat:false,altKey:false,ctrlKey:false,metaKey:false,preventDefault(){}});assert.equal($('v-0-pieces').textContent,'1');assert.equal($('v-1-pieces').textContent,'0');assert.match($('v-progress').textContent,/Human 1\/1000 pieces · Algorithm 0\/1000 pieces/);
  for(const now of [0,80,160,240,320]){const frames=[...jobs.values()];jobs.clear();frames.forEach(fn=>fn(now));assert.equal($('v-1-pieces').textContent,'0');assert.match($('v-progress').textContent,/Human 1\/1000 pieces · Algorithm 0\/1000 pieces/);await Promise.resolve();}
  const frames=[...jobs.values()];jobs.clear();frames.forEach(fn=>fn(400));await until(()=>!mounted.runner.view.busy);assert.equal($('v-1-pieces').textContent,'1');assert.equal($('v-0-pieces').textContent,'1');assert.match($('v-progress').textContent,/Human 1\/1000 pieces · Algorithm 1\/1000 pieces/);
 }finally{mounted.dispose();assert.equal(jobs.size,0);}
});
