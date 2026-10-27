import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHarness} from '../public/harness-ui.mjs';
import {mountComparison} from '../public/comparison-ui.mjs';
import {mountVersus} from '../public/versus-ui.mjs';
import {DEFAULT_CONFIG} from '../public/comparison.mjs';

function fixture(){
 const nodes=new Map(),events=new Map(),frames=new Map();let serial=0;
 class Element{
  constructor(){this.children=[];this.listeners={};this.attributes={};this.value='local';this.textContent='';}
  append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}
  setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,f){this.listeners[k]=f;}
  trigger(k){return this.listeners[k]?.({target:this});}focus(){doc.activeElement=this;}
 }
 const $=id=>{if(id==='decision-pairing')return null;if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 for(const [k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);$('c-right').value='local';
 const doc={getElementById:$,createElement:()=>new Element(),addEventListener(){},hidden:false,hasFocus:()=>true};
 const win={addEventListener(k,f){if(!events.has(k))events.set(k,[]);events.get(k).push(f);},requestAnimationFrame(f){frames.set(++serial,f);return serial;},cancelAnimationFrame(id){frames.delete(id);}};
 return {$,doc,win,frames,emit:(k,event)=>events.get(k)?.forEach(f=>f(event))};
}

for(const [name,prefix,mount]of [['solo','h',mountHarness],['comparison','c',mountComparison],['versus','v',mountVersus]]){
 test(`${name} retains its game and usable controls across cached navigation, and stops workers on final departure`,async()=>{
  const f=fixture(),mounted=mount(f.doc,{window:f.win});
  const step=()=>f.$(prefix+'-step').trigger('click'),pieces=()=>f.$(name==='solo'?'h-pieces':prefix+'-1-pieces').textContent;
  try{
   await step();assert.equal(pieces(),'1');
   f.emit('pagehide',{persisted:true});assert.equal(f.frames.size,0);
   f.emit('pageshow',{persisted:true});if(name==='versus')assert.equal(f.frames.size,1);
   assert.equal(pieces(),'1');await step();assert.equal(pieces(),'2');
   await f.$(prefix+'-start').trigger('click');
   f.emit('pagehide',{persisted:true});
   const view=name==='solo'?mounted.controller.view:name==='versus'?mounted.runner.view:mounted.view;
   assert.equal(view.busy,false);assert.notEqual(view.status??view.state,'running');assert.equal(f.frames.size,0);
   f.emit('pageshow',{persisted:true});
   f.emit('pagehide',{persisted:false});assert.equal(f.frames.size,0);
  }finally{mounted.dispose();}
 });
}
