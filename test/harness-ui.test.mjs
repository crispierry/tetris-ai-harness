import test from 'node:test';
import assert from 'node:assert/strict';
class Element {
 constructor(){this.children=[];this.attributes={};this.listeners={};this.value='local';this.textContent='';this.disabled=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,fn){this.listeners[k]=fn;}
 trigger(k){return this.listeners[k]?.({target:this});}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<150;n++){if(fn())return;await pause(10);}throw new Error('UI state did not settle');}
test('automatic mock error exposes recovery controls; Reset and Step recover; late cancelled mock cannot alter reset board',async()=>{
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 globalThis.document={getElementById:$,createElement:()=>new Element(),addEventListener:()=>{},hidden:false};
 await import('../public/harness-ui.mjs');
 $('h-provider').value='error';$('h-provider').trigger('change');$('h-start').trigger('click');
 await until(()=>$('h-status').textContent==='Choosing…');const waitingBoard=$('h-board').attributes['aria-label'];
 await until(()=>$('h-status').textContent==='Error');
 assert.equal($('h-pieces').textContent,'0');assert.equal($('h-board').attributes['aria-label'],waitingBoard);
 assert.equal($('h-start').disabled,false);assert.equal($('h-step').disabled,false);assert.equal($('h-provider').disabled,false);
 assert.equal($('h-pause').disabled,true);assert.equal($('h-reset').disabled,false);assert.match($('h-error').textContent,/Deliberate/);
 $('h-reset').trigger('click');assert.equal($('h-status').textContent,'Ready');assert.equal($('h-error').hidden,true);
 $('h-provider').value='local';$('h-provider').trigger('change');await $('h-step').trigger('click');
 assert.equal($('h-pieces').textContent,'1');assert.equal($('h-status').textContent,'Paused');assert.equal($('h-start').textContent,'Resume');
 $('h-stop').trigger('click');const stopped=$('h-board').attributes['aria-label'];await pause(200);assert.equal($('h-board').attributes['aria-label'],stopped);
 $('h-provider').value='delay';$('h-provider').trigger('change');$('h-start').trigger('click');
 await until(()=>$('h-status').textContent==='Choosing…');$('h-reset').trigger('click');const reset=$('h-board').attributes['aria-label'];
 await pause(450);assert.equal($('h-status').textContent,'Ready');assert.equal($('h-pieces').textContent,'0');assert.equal($('h-board').attributes['aria-label'],reset);
 delete globalThis.document;
});
