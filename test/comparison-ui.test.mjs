import test from 'node:test';
import assert from 'node:assert/strict';
import { mountComparison } from '../public/comparison-ui.mjs';
import { DEFAULT_CONFIG } from '../public/comparison.mjs';
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
  assert.match($('c-1-details').textContent,/local-leaf-value-1/);assert.match($('c-1-details').textContent,/maxOutputBytes/);
  $('c-samples').value='9';await $('c-step').trigger('click'); assert.match($('c-error').textContent,/samples/);assert.equal(c.view.locked,false);
  $('c-samples').value='1';$('c-left').value='error';$('c-right').value='local';$('c-pieceCap').value='2';
  await $('c-step').trigger('click'); assert.equal($('c-0-status').textContent,'Error'); assert.equal($('c-1-pieces').textContent,'1');
  assert.equal($('c-left').disabled,true);assert.equal($('c-pieceCap').disabled,true);assert.equal($('c-0-error').hidden,false);
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
