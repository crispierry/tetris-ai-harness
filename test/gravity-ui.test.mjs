import test from 'node:test';
import assert from 'node:assert/strict';
import {mountComparison} from '../public/comparison-ui.mjs';
import {mountHarness} from '../public/harness-ui.mjs';
import {mountVersus} from '../public/versus-ui.mjs';
import {Comparison,DEFAULT_CONFIG} from '../public/comparison.mjs';
import {HumanVersus} from '../public/versus.mjs';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
import {fakeClock} from './helpers/fake-clock.mjs';
class Element{constructor(){this.children=[];this.listeners={};this.value='';this.checked=false;this.textContent='';this.disabled=false;this.hidden=false;this.parentNode={hidden:false};}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){if(!this.disabled)return this.listeners[k]?.({target:this});}focus(){}}
function fixture(){const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};for(const[k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);for(const prefix of ['h','v']){$(prefix+'-provider').value='lookahead';$(prefix+'-depth').value='2';}for(const prefix of ['c','h','v'])$(prefix+'-gravity').checked=true;return {$,doc:{getElementById:$,createElement:()=>new Element(),addEventListener(){},hasFocus:()=>true,hidden:false},win:{addEventListener(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},matchMedia:()=>({matches:true})}};}
const micro=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
const until=async fn=>{for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw new Error('Gravity UI did not settle');};
test('mounted solo defaults to real gravity, works with reduced motion, freezes on Pause and switches back after Reset',async()=>{
 const {$,doc,win}=fixture(),clock=fakeClock(),h=mountHarness(doc,{window:win,clock});
 try{assert.equal(h.controller.view.gravity,true);const step=$('h-step').trigger('click');await step;assert.equal($('h-pieces').textContent,'1');assert.equal($('h-status').textContent,'Paused');assert.equal($('h-gravity').disabled,true);const row=$('h-board').children.flatMap((e,i)=>e.className.includes(' active')?[Math.floor(i/10)]:[]);assert(row.length>0);assert.equal(h.controller.view.pieces,1);
  await $('h-pause').trigger('click');await step;assert.equal($('h-status').textContent,'Paused');assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(h.exportRun()).ok,true);
  await $('h-reset').trigger('click');assert.equal($('h-gravity').disabled,false);$('h-gravity').checked=false;await $('h-gravity').trigger('change');await $('h-step').trigger('click');assert.equal($('h-pieces').textContent,'1');assert.equal(h.controller.view.gravity,undefined);assert.equal(verifyDecisionUIRecord(h.exportRun()).ok,true);
 }finally{h.dispose();}
});
test('mounted comparison keeps two independent falling boards, locks timing, and replays without new choices',async()=>{
 const {$,doc,win}=fixture(),clock=fakeClock(),c=mountComparison(doc,{window:win,comparisonFactory:options=>new Comparison({...options,clock})});
 try{const step=$('c-step').trigger('click');await step;assert.equal($('c-gravity').disabled,true);assert.deepEqual(c.view.lanes.map(l=>l.pieces),[1,1]);assert.equal(verifyDecisionUIRecord(c.exportRun()).ok,true);
  const json=c.exportRun();c.replay();c.pause();await c.step();assert.equal(c.exportRun(),json);c.reset();assert.equal($('c-gravity').disabled,false);$('c-gravity').checked=false;await $('c-gravity').trigger('change');assert.equal(c.view.config.gravity,false);
 }finally{c.dispose();}
});
test('mounted versus enables computer gravity while computer Step leaves human time and position unchanged',async()=>{
 const {$,doc,win}=fixture(),clock=fakeClock(),v=mountVersus(doc,{window:win,runnerFactory:options=>new HumanVersus({...options,clock})});
 try{assert.equal(v.runner.view.gravity,true);const before=v.runner.view.lanes[0],step=$('v-step').trigger('click');await step;assert.equal($('v-1-status').textContent,'Paused');assert.deepEqual(v.runner.view.lanes[0],before);assert.equal(v.runner.view.lanes[1].pieces,1);assert.equal(v.runner.view.lanes[0].pieces,0);assert.equal(verifyDecisionUIRecord(v.runner.exportRun()).ok,true);await $('v-reset').trigger('click');$('v-gravity').checked=false;await $('v-gravity').trigger('change');assert.equal(v.runner.view.gravity,false);
 }finally{v.dispose();}
});

test('gravity stays visible during thinking, then the Space-drop animation starts from that fallen pose',async()=>{
 const {$,doc,win}=fixture(),clock=fakeClock(),jobs=new Map(),release=[];let serial=0;
 win.matchMedia=()=>({matches:false});win.requestAnimationFrame=fn=>{jobs.set(++serial,fn);return serial;};win.cancelAnimationFrame=id=>jobs.delete(id);
 const {heuristic}=await import('../public/controller.mjs'),base=heuristic();
 const c=mountComparison(doc,{window:win,comparisonFactory:options=>new Comparison({...options,clock,providerFactory:(key,config,{lane})=>({...base,async decide(p){await new Promise(r=>release[lane]=r);return base.decide(p);}})})});
 try{const step=$('c-step').trigger('click');await until(()=>release.length===2&&release.every(Boolean));await clock.advance(800);const rows=()=>$('c-0-board').children.flatMap((e,i)=>e.className.includes(' active')?[Math.floor(i/10)]:[]);assert.equal(Math.min(...rows()),1);assert.equal($('c-0-status').textContent,'Choosing…');release.forEach(r=>r());await until(()=>c.view.lanes.every(l=>l.presentation?.phase==='placing'));
  assert(c.view.lanes.every(l=>l.presentation.before.observation.active.y>=1));assert(c.view.lanes.every(l=>l.pieces===1));assert.equal($('c-0-pieces').textContent,'0');const shown=[];
  for(const now of [0,80,160,240,320,400]){const batch=[...jobs.values()];jobs.clear();batch.forEach(fn=>fn(now));if(rows().length)shown.push(Math.min(...rows()));await micro();}
  await step;assert(new Set(shown).size>=3);assert.equal($('c-0-pieces').textContent,'1');assert.equal($('c-0-status').textContent,'Paused');assert.equal(jobs.size,0);assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(c.exportRun()).ok,true);
 }finally{c.dispose();}
});
