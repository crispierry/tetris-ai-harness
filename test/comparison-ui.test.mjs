import test from 'node:test';
import assert from 'node:assert/strict';
import { mountComparison } from '../public/comparison-ui.mjs';
import { Comparison, DEFAULT_CONFIG } from '../public/comparison.mjs';
class Element {
  constructor(){this.children=[];this.attributes={};this.listeners={};this.value='';this.textContent='';this.disabled=false;this.hidden=false;}
  append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this.attributes[key]=value;} addEventListener(key,fn){this.listeners[key]=fn;}
  trigger(key){if(!this.disabled)return this.listeners[key]?.({target:this});}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await pause(10);}throw new Error('UI did not settle.');}
function fixture(){const nodes=new Map(),listeners={};const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  for(const[key,value]of Object.entries(DEFAULT_CONFIG))$('c-'+key).value=String(value);
  return {$,doc:{getElementById:$,createElement:()=>new Element(),addEventListener:(key,fn)=>listeners[key]=fn,hidden:false},listeners};}

test('actual facade UI controls validate, lock, retain errors, replay without decisions and export the same saved run',async()=>{
  const {$,doc}=fixture();let exported;const c=mountComparison(doc,{onExport:json=>{exported=JSON.parse(json);}});
  assert.equal($('c-0-board').children.length,200); assert.equal($('c-start').disabled,false);
  assert.match($('c-1-details').textContent,/local-leaf-value-2/);assert.match($('c-1-details').textContent,/maxOutputBytes/);
  $('c-samples').value='9';await $('c-step').trigger('click'); assert.match($('c-error').textContent,/samples/);assert.equal(c.view.locked,false);
  $('c-samples').value='1';$('c-left').value='error';$('c-right').value='local';$('c-pieceCap').value='2';
  await $('c-step').trigger('click'); assert.equal($('c-0-status').textContent,'Error'); assert.equal($('c-1-pieces').textContent,'1');
  assert.equal($('c-left').disabled,true);assert.equal($('c-pieceCap').disabled,true);assert.equal($('c-0-error').hidden,false);
  assert.equal($('c-0-outcome').textContent,'');assert.match($('c-0-error').textContent,/Deliberate/);
  const board=$('c-0-board').attributes['aria-label'];await $('c-stop').trigger('click'); await $('c-step').trigger('click');
  assert.equal($('c-0-status').textContent,'Error');assert.equal($('c-0-board').attributes['aria-label'],board);assert.equal($('c-1-pieces').textContent,'2');
  assert.match($('c-results').textContent,/Observed: 1/);await $('c-export').trigger('click');assert.equal(exported.summary.observedPairs,1);
  const count=c.view.frameCount;await $('c-replay').trigger('click');await $('c-pause').trigger('click');await $('c-step').trigger('click');
  assert.match($('c-progress').textContent,/Saved visual replay/);assert.equal(c.view.frameCount,count);assert.equal($('c-0-status').textContent,'Saved replay');
  await $('c-reset').trigger('click');assert.equal($('c-left').disabled,false);assert.equal($('c-0-pieces').textContent,'0');assert.equal($('c-replay').disabled,true);c.dispose();
});

test('automatic waiting can be paused and reset, visibility hides cancel work, no global keyboard capture exists',async()=>{
  const {$,doc,listeners}=fixture();const c=mountComparison(doc);
  $('c-left').value='delay';$('c-right').value='local';await $('c-start').trigger('click');
  assert.equal($('c-0-status').textContent,'Choosing…');assert.equal($('c-pause').disabled,false);
  await $('c-pause').trigger('click');assert.equal($('c-0-status').textContent,'Paused');await pause(300);assert.equal($('c-0-pieces').textContent,'0');
  await $('c-start').trigger('click');await until(()=>$('c-0-status').textContent==='Choosing…');doc.hidden=true;listeners.visibilitychange();
  assert.equal(c.view.auto,false);await $('c-reset').trigger('click');await pause(300);assert.equal($('c-0-pieces').textContent,'0');
  assert.equal(listeners.keydown,undefined);assert.equal($('c-pause').disabled,true);c.dispose();
});

test('mounted comparison terminal announcements interpolate each lane identity and announce a frozen winner once',()=>{
  const {$,doc}=fixture();let emit;
  const c=mountComparison(doc,{comparisonFactory:options=>{emit=options.onChange;return new Comparison(options);}});
  const terminal=(view,index,status)=>{
    const lane=view.lanes[index];lane.status=status;lane.error=status==='error'?'Distinct right failure':null;
    lane.outcome={status,censored:status==='capped'||status==='error',reason:status==='won'?'300-line target reached':status==='over'?'blocked spawn':'piece cap'};
    lane.observation={...lane.observation,active:null,status,lines:status==='won'?300:10,level:status==='won'?30:2};
  };
  const view=structuredClone(c.view);view.state='completed';view.locked=true;
  terminal(view,0,'won');terminal(view,1,'capped');emit(view);
  assert.match($('c-announcement').textContent,/Left: Marathon complete/);assert.match($('c-announcement').textContent,/Right: Capped/);
  assert(!/\[.*\]\[i\]/.test($('c-announcement').textContent));
  terminal(view,1,'error');emit(view);assert.match($('c-announcement').textContent,/Right: Error/);assert.doesNotMatch($('c-announcement').textContent,/Left: Marathon complete/);
  terminal(view,0,'over');emit(view);assert.match($('c-announcement').textContent,/Left: Game over/);c.dispose();
});

test('Stop disables after the final comparison finishes, while unfinished play and replay stay stoppable',()=>{
  const {$,doc}=fixture();let emit;
  const c=mountComparison(doc,{comparisonFactory:options=>{emit=options.onChange;return new Comparison(options);}});
  try {
    assert.equal($('c-stop').disabled,true);
    const view=structuredClone(c.view);view.locked=true;view.state='running';view.auto=true;
    view.lanes[0].status='won';view.lanes[0].outcome={status:'won'};view.lanes[0].observation.lines=300;
    emit(view);assert.equal($('c-stop').disabled,false,'the other model is still playing');
    view.lanes[1].status='won';view.lanes[1].outcome={status:'won'};view.lanes[1].observation.lines=300;
    view.busy=true;emit(view);assert.equal($('c-stop').disabled,false,'the final drop animation can still be stopped');
    view.busy=false;view.auto=false;view.state='completed';
    for(const status of ['won','over','capped','error']){
      view.lanes[1].status=status;view.lanes[1].outcome={status};emit(view);
      assert.equal($('c-stop').disabled,true,`finished ${status} comparison`);
    }
    view.state='paused';emit(view);assert.equal($('c-stop').disabled,true,'all final outcomes are settled even if paused');
    view.config.samples=2;emit(view);assert.equal($('c-stop').disabled,false,'another sample remains');
    view.config.samples=1;view.mode='replay';view.state='replay';view.auto=true;
    emit(view);assert.equal($('c-stop').disabled,false,'saved replay remains stoppable');
  } finally {c.dispose();}
});

test('automatic comparison disables Stop when both controllers reach their placement limit',async()=>{
  const {$,doc}=fixture();const c=mountComparison(doc);
  try {
    $('c-left').value='local';$('c-right').value='local';$('c-pieceCap').value='1';
    await $('c-start').trigger('click');await until(()=>c.view.state==='completed');
    assert(c.view.lanes.every(l=>l.outcome.status==='capped'));
    assert.equal($('c-stop').disabled,true);assert.equal($('c-pause').disabled,true);
    assert.equal($('c-reset').disabled,false);
  } finally {c.dispose();}
});
