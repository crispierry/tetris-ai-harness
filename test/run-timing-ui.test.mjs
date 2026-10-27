import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHarness} from '../public/harness-ui.mjs';
import {mountComparison} from '../public/comparison-ui.mjs';
import {Comparison,DEFAULT_CONFIG} from '../public/comparison.mjs';
import {heuristic} from '../public/controller.mjs';
import {fakeClock} from './helpers/fake-clock.mjs';
const micro=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
class E{constructor(){this.children=[];this.listeners={};this.value='';this.textContent='';this.checked=false;this.disabled=false;this.hidden=false;this.parentNode={hidden:false};}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=[...x];}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){return this.listeners[k]?.({target:this});}}
function fixture(clock){const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new E());return nodes.get(id);};for(const[k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);$('h-provider').value='local';return {$,doc:{getElementById:$,createElement:()=>new E(),addEventListener(){},hidden:false},win:{...clock,addEventListener(){},matchMedia:()=>({matches:true})}};}
test('mounted comparison updates separate clocks and displays one measured completion summary',async()=>{
 const clock=fakeClock(),{$,doc,win}=fixture(clock),base=heuristic(),release=[];const c=mountComparison(doc,{window:win,comparisonFactory:options=>new Comparison({...options,clock,providerFactory:(key,config,{lane})=>({...base,async decide(p){await new Promise(r=>release[lane]=r);return base.decide(p);}})})});
 try{$('c-pieceCap').value='1';const step=$('c-step').trigger('click');await micro();await clock.advance(500);assert.equal($('c-0-clock').textContent,'00:00.5');release[0]();await micro();await clock.advance(500);assert.equal($('c-0-clock').textContent,'00:00.5');assert.equal($('c-1-clock').textContent,'00:01.0');release[1]();await step;assert.equal($('c-speed-summary').hidden,false);assert.match($('c-speed-text').textContent,/2.0×/);assert.match($('c-speed-detail').textContent,/placement limit/);const text=$('c-speed-text').textContent,json=c.exportRun();c.replay();c.pause();await clock.advance(5000);assert.equal($('c-speed-text').textContent,text);assert.equal($('c-0-clock').textContent,'00:00.5');assert.equal(c.exportRun(),json);c.reset();assert.equal($('c-0-clock').textContent,'00:00.0');assert.equal($('c-speed-summary').hidden,true);assert.equal(clock.size,0);}finally{c.dispose();assert.equal(clock.size,0);}
});
test('mounted solo clock excludes pause and manual idle time, then resets without retaining old work',async()=>{
 const clock=fakeClock(),{$,doc,win}=fixture(clock),h=mountHarness(doc,{window:win,clock}),base=heuristic();let release;h.controller.setProvider({...base,async decide(p){await new Promise(r=>release=r);return base.decide(p);}});
 try{const step=$('h-step').trigger('click');await micro();await clock.advance(800);assert.equal($('h-clock').textContent,'00:00.8');await $('h-pause').trigger('click');await step;const frozen=h.timing.elapsedMs;release();await clock.advance(5000);assert.equal(h.timing.elapsedMs,frozen);assert.equal($('h-clock').textContent,'00:00.8');await $('h-reset').trigger('click');assert.equal($('h-clock').textContent,'00:00.0');assert.equal(clock.size,0);}finally{h.dispose();assert.equal(clock.size,0);}
});
test('failed comparison shows an incomplete result instead of rewarding the faster failure',async()=>{
 const clock=fakeClock(),{$,doc,win}=fixture(clock),base=heuristic();const c=mountComparison(doc,{window:win,comparisonFactory:options=>new Comparison({...options,clock,providerFactory:(key,config,{lane})=>lane?base:{...base,decide:async()=>{throw new Error('test failure');}}})});
 try{$('c-pieceCap').value='1';await $('c-step').trigger('click');assert.equal($('c-speed-summary').hidden,false);assert.equal($('c-speed-heading').textContent,'Run incomplete');assert.doesNotMatch($('c-speed-text').textContent,/faster|sooner|×/);assert.equal(clock.size,0);}finally{c.dispose();}
});

for(const event of ['blur','visibilitychange'])test(`solo manual drop pauses its animation and clock on ${event}`,async()=>{
 const clock=fakeClock(),{$,doc,win}=fixture(clock),listeners={},frames=new Map();let serial=0;
 doc.addEventListener=(name,fn)=>listeners[name]=fn;win.addEventListener=(name,fn)=>listeners[name]=fn;
 win.matchMedia=()=>({matches:false});win.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};win.cancelAnimationFrame=id=>frames.delete(id);
 const h=mountHarness(doc,{window:win,clock});
 try{const step=$('h-step').trigger('click');await micro();assert.equal(frames.size,1);assert.equal(h.controller.view.busy,false);await clock.advance(400);doc.hidden=event==='visibilitychange';listeners[event]();
  assert.equal(frames.size,0);assert.equal(h.timing.running,false);await step;const frozen=h.timing.elapsedMs;await clock.advance(5000);assert.equal(h.timing.elapsedMs,frozen);assert.equal(clock.size,0);
 }finally{h.dispose();}
});

test('solo clock resumes when the user retries a local decision failure',async()=>{
 const clock=fakeClock(),{$,doc,win}=fixture(clock),h=mountHarness(doc,{window:win,clock}),base=heuristic();let release,fail=true;
 h.controller.setProvider({...base,async decide(p){await new Promise(r=>release=r);if(fail)throw new Error('local test failure');return base.decide(p);}});
 try{const first=$('h-step').trigger('click');await micro();await clock.advance(500);release();await first;assert.equal(h.controller.view.status,'error');assert.equal(h.timing.running,false);
  await clock.advance(5000);fail=false;const second=$('h-step').trigger('click');await micro();await clock.advance(300);release();await second;assert.equal(h.controller.view.pieces,1);assert.equal(h.timing.elapsedMs,800);
 }finally{h.dispose();}
});
