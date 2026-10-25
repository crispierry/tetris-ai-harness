import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVersus } from '../public/versus-ui.mjs';
import { HumanVersus, VERSUS_LIMITS } from '../public/versus.mjs';
import { heuristic, mockProvider } from '../public/controller.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await pause(5);}throw new Error('Versus UI did not settle.');}
function fixture(){const nodes=new Map(),docListeners={},winListeners={},frames=new Map();let serial=0;
  const doc={activeElement:null,hidden:false,hasFocus:()=>true,getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement:()=>new Element(),addEventListener:(k,fn)=>docListeners[k]=fn};
  class Element{constructor(){this.children=[];this.attributes={};this.listeners={};this.disabled=false;this.hidden=false;this.textContent='';}
    append(...n){this.children.push(...n);}replaceChildren(...n){this.children=[...n];}setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}focus(){doc.activeElement=this;}
    trigger(k,event={}){if(!this.disabled)return this.listeners[k]?.(event);}}
  const win={addEventListener:(k,fn)=>winListeners[k]=fn,requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)};
  return {doc,win,$:doc.getElementById,docListeners,winListeners,frame:now=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn(now);},frames};
}
function key(surface,value,extra={}){let prevented=false;surface.trigger('keydown',{key:value,repeat:false,altKey:false,ctrlKey:false,metaKey:false,preventDefault(){prevented=true;},...extra});return prevented;}

test('focused human keyboard/clock remains independent during Choosing; blur freezes both and stale completion is ignored',async()=>{
  const f=fixture(),jobs=[],base=heuristic();const m=mountVersus(f.doc,{window:f.win,runnerFactory:options=>new HumanVersus({...options,providerFactory:()=>({...base,kind:'mock',decide:p=>new Promise(resolve=>jobs.push(async()=>resolve(await base.decide(p))))})})});
  await f.$('v-start').trigger('click');await until(()=>jobs.length===1);assert.equal(f.doc.activeElement,f.$('v-human-game'));assert.equal(f.$('v-1-status').textContent,'Choosing…');
  const human=f.$('v-0-board').attributes['aria-label'];assert.equal(key(f.$('v-human-game'),'ArrowLeft'),true);
  assert.notEqual(f.$('v-0-board').attributes['aria-label'],human);assert.equal(f.$('v-1-pieces').textContent,'0');
  f.frame(1000);f.frame(1200);f.frame(1400);f.frame(1600);f.frame(1800);assert.match(f.$('v-0-board').attributes['aria-label'],/row 2/);
  const rotation=m.runner.view.lanes[0].observation.active.rotation;key(f.$('v-human-game'),'ArrowUp',{repeat:true});assert.equal(m.runner.view.lanes[0].observation.active.rotation,rotation);
  const before=m.runner.view.lanes[0];assert.equal(key(f.$('v-human-game'),'ArrowLeft',{ctrlKey:true}),false);assert.deepEqual(m.runner.view.lanes[0],before);
  f.doc.activeElement=f.$('unrelated-input');assert.equal(key(f.$('v-human-game'),' '),false);assert.equal(f.docListeners.keydown,undefined);
  f.$('v-human-game').trigger('blur');assert.equal(m.runner.view.state,'paused');const paused=m.runner.view.lanes[0];f.frame(5000);await jobs[0]();await pause(0);
  assert.deepEqual(m.runner.view.lanes[0],paused);assert.equal(m.runner.view.lanes[1].pieces,0);m.dispose();assert.equal(f.frames.size,0);
});

test('AI-only stepping, stop/reset, replay/export and window hiding use the real facade and truthful labels',async()=>{
  const f=fixture();let exported;const m=mountVersus(f.doc,{window:f.win,onExport:json=>{exported=JSON.parse(json);}});
  assert.equal(f.$('v-0-board').children.length,200);await f.$('v-step').trigger('click');
  assert.equal(f.$('v-0-pieces').textContent,'0');assert.equal(f.$('v-0-status').textContent,'Ready');assert.equal(f.$('v-1-pieces').textContent,'1');assert.equal(f.$('v-step').textContent,'Step algorithm');
  await f.$('v-start').trigger('click');key(f.$('v-human-game'),' ');assert.equal(f.$('v-0-pieces').textContent,'1');
  f.doc.hidden=true;f.docListeners.visibilitychange();assert.equal(m.runner.view.state,'paused');f.doc.hidden=false;
  await f.$('v-stop').trigger('click');assert.equal(f.$('v-0-pieces').textContent,'1');await f.$('v-export').trigger('click');assert(exported.frames.length>2);assert.equal(exported.provenance.modelCalls,0);
  const count=m.runner.view.frameCount;await f.$('v-replay').trigger('click');await f.$('v-pause').trigger('click');assert.equal(f.$('v-step').textContent,'Next saved frame');
  assert.match(f.$('v-progress').textContent,/Saved visual replay/);const saved=m.runner.view.lanes;key(f.$('v-human-game'),' ');assert.deepEqual(m.runner.view.lanes,saved);assert.equal(m.runner.view.frameCount,count);
  await f.$('v-reset').trigger('click');assert.equal(f.$('v-0-pieces').textContent,'0');assert.equal(f.$('v-1-pieces').textContent,'0');assert.equal(f.$('v-replay').disabled,true);assert.equal(f.$('v-start').disabled,false);m.dispose();
});

test('local test error preserves human play and exposes usable stop/reset without fallback',async()=>{
  const f=fixture();let failing=true;const m=mountVersus(f.doc,{window:f.win,runnerFactory:options=>new HumanVersus({...options,providerFactory:()=>failing?mockProvider({mode:'error',delayMs:0}):heuristic()})});
  await f.$('v-start').trigger('click');await until(()=>f.$('v-1-status').textContent==='Error');assert.match(f.$('v-1-error').textContent,/Deliberate/);
  key(f.$('v-human-game'),' ');assert.equal(f.$('v-0-pieces').textContent,'1');assert.equal(f.$('v-1-pieces').textContent,'0');assert.equal(f.$('v-reset').disabled,false);
  failing=false;await f.$('v-reset').trigger('click');await f.$('v-step').trigger('click');assert.equal(f.$('v-1-pieces').textContent,'1');assert.equal(f.$('v-1-error').hidden,true);m.dispose();
});

test('capacity exhaustion stops live play but retained replay can pause, advance one frame and resume',async()=>{
  const f=fixture();let choices=0;const base=heuristic();
  const m=mountVersus(f.doc,{window:f.win,runnerFactory:options=>new HumanVersus({...options,providerFactory:()=>({...base,async decide(p){choices++;return base.decide(p);}})})});
  await f.$('v-start').trigger('click');
  for(let n=0;n<VERSUS_LIMITS.frames+1&&!m.runner.view.archiveError;n++)m.runner.input(n%2?'left':'right');
  assert(m.runner.view.archiveError);assert.equal(f.$('v-start').disabled,true);assert.equal(f.$('v-step').disabled,true);
  const count=m.runner.view.frameCount,decisions=choices,retainedExport=m.runner.exportRun();
  await f.$('v-replay').trigger('click');await f.$('v-pause').trigger('click');
  assert.equal(f.$('v-start').disabled,false);assert.equal(f.$('v-step').disabled,false);assert.equal(f.$('v-step').textContent,'Next saved frame');
  const replayBefore=m.runner.view.lanes;key(f.$('v-human-game'),' ');f.frame(10000);assert.deepEqual(m.runner.view.lanes,replayBefore);
  const index=m.runner.view.replayIndex;await f.$('v-step').trigger('click');assert.equal(m.runner.view.replayIndex,index+1);
  await f.$('v-start').trigger('click');assert.equal(m.runner.view.playback,true);assert.equal(m.runner.view.replayIndex,index+2);
  await f.$('v-pause').trigger('click');assert.equal(m.runner.view.frameCount,count);assert.equal(choices,decisions);
  assert.equal(m.runner.exportRun(),retainedExport);assert.equal(JSON.parse(m.runner.exportRun()).archiveIncomplete,true);m.dispose();
});

test('mounted versus terminal announcements interpolate Human and Algorithm without repeating a frozen winner',()=>{
  const f=fixture();let emit;
  const m=mountVersus(f.doc,{window:f.win,runnerFactory:options=>{emit=options.onChange;return new HumanVersus(options);}});
  const terminal=(view,index,status)=>{
    const lane=view.lanes[index];lane.status=status;lane.error=status==='error'?'Distinct algorithm failure':null;
    lane.outcome={status,censored:status==='capped'||status==='error',reason:status==='won'?'300-line target reached':status==='over'?'blocked spawn':'piece cap'};
    lane.observation={...lane.observation,active:null,status,lines:status==='won'?300:10,level:status==='won'?30:2};
  };
  const view=structuredClone(m.runner.view);view.state='completed';view.running=false;
  terminal(view,0,'won');terminal(view,1,'capped');emit(view);
  assert.match(f.$('v-announcement').textContent,/Human: Marathon complete/);assert.match(f.$('v-announcement').textContent,/Algorithm: Capped/);
  assert(!/\[.*\]\[i\]/.test(f.$('v-announcement').textContent));
  terminal(view,1,'error');emit(view);assert.match(f.$('v-announcement').textContent,/Algorithm: Error/);assert.doesNotMatch(f.$('v-announcement').textContent,/Human: Marathon complete/);
  terminal(view,0,'over');emit(view);assert.match(f.$('v-announcement').textContent,/Human: Game over/);m.dispose();
});
