import test from 'node:test';
import assert from 'node:assert/strict';
import {mountComparison} from '../public/comparison-ui.mjs';
import {mountHarness} from '../public/harness-ui.mjs';
import {mountVersus} from '../public/versus-ui.mjs';
import {Comparison, DEFAULT_CONFIG, providerFor} from '../public/comparison.mjs';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
class Element{
 constructor(){this.children=[];this.listeners={};this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.parentNode={hidden:false};}
 append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(){}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){return this.listeners[k]?.({target:this});}focus(){}
}
function fixture(){const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};for(const[k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);$('h-provider').value='lookahead';$('h-depth').value='2';$('v-provider').value='lookahead';$('v-depth').value='2';return {$,doc:{getElementById:$,createElement:()=>new Element(),addEventListener(){},hasFocus:()=>true,hidden:false},win:{addEventListener(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){}}};}
test('comparison keeps each selected depth independent, locks it during play, and replays without changing its saved policy',async()=>{
 // This checks UI policy ownership, not search speed. The actual beam search
 // and its deadlines are covered independently in beam-lookahead.test.mjs.
 const {$,doc,win}=fixture(),c=mountComparison(doc,{window:win,comparisonFactory:options=>new Comparison({...options,providerFactory:(key,config)=>{
  const policy=providerFor(key,config),fast=providerFor('local',config);
  return {...policy,decide:fast.decide};
 }})});
 try{
  $('c-leftDepth').value='6';await $('c-leftDepth').trigger('change');$('c-rightDepth').value='3';await $('c-rightDepth').trigger('change');
  assert.equal(c.view.lanes[0].policy.search.depth,6);assert.equal(c.view.lanes[1].policy.search.depth,3);assert.equal($('c-0-heading').textContent,'Lookahead · 6');assert.equal($('c-1-heading').textContent,'Lookahead · 3');
  await $('c-step').trigger('click');assert.deepEqual(c.view.lanes.map(l=>l.pieces),[1,1]);assert.equal($('c-leftDepth').disabled,true);assert.equal($('c-rightDepth').disabled,true);
  const json=c.exportRun();await $('c-replay').trigger('click');await $('c-pause').trigger('click');await $('c-step').trigger('click');assert.equal(c.exportRun(),json);
  await $('c-reset').trigger('click');assert.equal($('c-leftDepth').disabled,false);assert.equal($('c-rightDepth').disabled,false);
  $('c-right').value='openai';await $('c-right').trigger('change');assert.equal($('c-rightDepth').parentNode.hidden,true);assert.equal($('c-rightDepth').disabled,true);assert.equal($('c-leftDepth').parentNode.hidden,false);assert.equal($('c-start').disabled,true);
 }finally{c.dispose();}
});
test('solo computer selects depth6, exports canonical search receipts, and unlocks depth after Reset',async()=>{
 const {$,doc,win}=fixture(),h=mountHarness(doc,{window:win});
 try{
  assert.equal(h.controller.view.player.name,'Local lookahead depth 2');$('h-depth').value='6';await $('h-depth').trigger('change');assert.equal($('player-heading').textContent,'Lookahead · 6');
  await $('h-step').trigger('click');assert.equal(h.controller.view.pieces,1);assert.equal($('h-depth').disabled,true);const json=h.exportRun();assert.equal(verifyDecisionUIRecord(json).ok,true);assert.equal(JSON.parse(json).lanes[0].policy.search.depth,6);
  await $('h-reset').trigger('click');assert.equal($('h-depth').disabled,false);$('h-depth').value='3';await $('h-depth').trigger('change');await $('h-step').trigger('click');assert.equal(h.controller.view.pieces,1);assert.equal(JSON.parse(h.exportRun()).lanes[0].policy.search.depth,3);
 }finally{h.dispose();}
});
test('human versus computer applies depth choices while preserving the human board',async()=>{
 const {$,doc,win}=fixture(),v=mountVersus(doc,{window:win});
 try{
  $('v-depth').value='5';await $('v-depth').trigger('change');assert.equal($('v-1-heading').textContent,'Lookahead · 5');assert.equal(v.runner.view.policies[1].search.depth,5);
  await $('v-step').trigger('click');assert.equal(v.runner.view.lanes[1].pieces,1);assert.equal(v.runner.view.lanes[0].pieces,0);assert.equal($('v-depth').disabled,true);
  await $('v-reset').trigger('click');assert.equal($('v-depth').disabled,false);$('v-depth').value='6';await $('v-depth').trigger('change');await $('v-step').trigger('click');assert.equal(v.runner.view.lanes[1].pieces,1);assert.equal(v.runner.view.policies[1].search.depth,6);
 }finally{v.dispose();}
});
