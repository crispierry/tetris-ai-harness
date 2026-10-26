import { RULES } from './engine.mjs';
import { VERSIONS, freeze } from './harness.mjs';
export const DECISION_RECORD_LIMITS=freeze({solo:{frames:2002,bytes:16*1024*1024},comparison:{frames:4000,bytes:16*1024*1024},versus:{frames:50000,bytes:64*1024*1024}});
export function decisionRecord({mode,policies,frames,finals,reasons,metadata={}}) {
 const limit=DECISION_RECORD_LIMITS[mode];if(!limit||!Array.isArray(frames)||frames.length>limit.frames)throw new Error('Recording frame limit reached.');
 if(!Array.isArray(policies)||policies.length>(mode==='solo'?1:2)||policies.some(p=>new TextEncoder().encode(JSON.stringify(p)).length>16384)||new TextEncoder().encode(JSON.stringify(metadata)).length>160*1024)throw new Error('Recording metadata limit reached.');
 for(const frame of frames){const receipt=frame?.decision?.receipt??frame?.lastDecision?.receipt;if(receipt&&new TextEncoder().encode(JSON.stringify(receipt)).length>4096)throw new Error('Recording receipt limit reached.');if(frame.pieces!==undefined&&(!Number.isInteger(frame.pieces)||frame.pieces<0||frame.pieces>1000))throw new Error('Recording placement limit reached.');}
 const record={version:'decision-ui-record-1',mode,rulesVersion:RULES.version,schemas:VERSIONS,objective:{targetLines:300,startLevel:1,maxLevel:30},policies,frames,finals,reasons,metadata,replay:'Stored visible frames only; zero new decisions'};
 const json=JSON.stringify(record);if(new TextEncoder().encode(json).length>limit.bytes)throw new Error('Recording byte limit reached.');return json;
}


export const DECISION_RECORD_VERSION = 'decision-ui-record-2';
export const CANONICAL_EVENT_BYTES = 16384;
const copy = value => JSON.parse(JSON.stringify(value));
const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;
/** Public facts only. Never copy an engine state, provider packet, or response. */
export function recordedObservation(o) {
 return {sessionId:o.sessionId,revision:o.revision,board:o.board.map(r=>typeof r==='string'?r:r.map(c=>c??'.').join('')),
 active:o.active?{type:o.active.type,rotation:o.active.rotation,x:o.active.x,y:o.active.y,cells:o.active.cells.map(({x,y})=>({x,y}))}:null,
 next:[...o.next],score:o.score,lines:o.lines,level:o.level,status:o.status,gravityElapsedMs:o.gravityElapsedMs,terminalReason:o.terminalReason};
}
export function recordedPolicy(p) {
 if(byteSize(p)>16384)throw new Error('Recording policy limit reached.');
 return copy(p);
}
export class DecisionJournal {
 #mode; #cap; #lanes=[]; #events=[]; #bytes=0; #archive=null; #limit; #tickMerge=false;
 constructor({mode,pieceCap=1000,eventLimit,byteLimit}={}) {
  if(!DECISION_RECORD_LIMITS[mode]||!Number.isInteger(pieceCap)||pieceCap<1||pieceCap>1000)throw new Error('Invalid canonical recording configuration');
  this.#mode=mode;this.#cap=pieceCap;this.#limit={events:eventLimit??DECISION_RECORD_LIMITS[mode].frames,bytes:byteLimit??DECISION_RECORD_LIMITS[mode].bytes};
 }
 get incomplete(){return this.#archive!==null;}
 get archiveError(){return this.#archive;}
 get eventCount(){return this.#events.length;}
 censor(reason='Canonical recording capacity reached. Retained prefix only; unfinished lanes are censored.'){this.#archive??=reason;}
 addLane(id,kind,view,policy) {
  if(this.#events.length||this.#lanes.some(l=>l.id===id)||!['human','computer'].includes(kind))throw new Error('Invalid canonical lane');
  this.#lanes.push(freeze({id,kind,initial:{observation:recordedObservation(view.observation),pieces:view.pieces,status:view.status},policy:recordedPolicy(policy)}));
 }
 append(lane,input,view) {
  if(this.#archive)throw new Error(this.#archive);
  if(!this.#lanes.some(l=>l.id===lane))throw new Error('Unknown canonical lane');
  const previous=this.#events.findLast(e=>e.lane===lane)??this.#lanes.find(l=>l.id===lane).initial;
  if(['over','won'].includes(previous.observation.status)||previous.pieces>=this.#cap){if(['start','pause','stop'].includes(input.kind))return;throw new Error('Canonical lane is terminal');}
  const observation=recordedObservation(view.observation),noLock=view.pieces===previous.pieces;
  const last=this.#events.at(-1),merge=input.kind==='tick'&&noLock&&this.#tickMerge&&last?.lane===lane&&last.input.kind==='ticks'&&last.input.elapsedMs.length<256;
  const canonicalInput=input.kind==='tick'?{kind:'ticks',elapsedMs:merge?[...last.input.elapsedMs,input.elapsedMs]:[input.elapsedMs]}:input;
  const event=copy({seq:merge?last.seq:this.#events.length,lane,input:canonicalInput,observation,pieces:view.pieces,status:view.status});
  const bytes=byteSize(event),replaced=merge?byteSize(last):0;
  // Reserve bounded metadata/finals and reject the proposed transition BEFORE its owner commits.
  if(bytes>CANONICAL_EVENT_BYTES||(!merge&&this.#events.length>=this.#limit.events)||this.#bytes+bytes-replaced>this.#limit.bytes-160*1024){
   this.#archive='Canonical recording capacity reached. Retained prefix only; unfinished lanes are censored.';throw new Error(this.#archive);
  }
  if(merge)this.#events.pop();this.#events.push(freeze(event));this.#bytes+=bytes-replaced;this.#tickMerge=input.kind==='tick'&&noLock;
 }
 exportRun({metadata={accounting:null}}={}) {
  const finals=this.#lanes.map(l=>{const last=this.#events.findLast(e=>e.lane===l.id)??l.initial;
   const o=last.observation;let outcome=o.status==='won'?'won':o.status==='over'?'over':last.pieces>=this.#cap?'capped':this.#events.findLast(e=>e.lane===l.id&&['error','cancel','computer'].includes(e.input.kind))?.input.kind==='error'?'error':this.#events.findLast(e=>e.lane===l.id&&['error','cancel','computer'].includes(e.input.kind))?.input.kind==='cancel'?'cancelled':this.#archive?'archive':'incomplete';
   return {lane:l.id,observation:o,pieces:last.pieces,status:last.status,outcome,censored:!['won','over'].includes(outcome)};});
  const record={version:DECISION_RECORD_VERSION,mode:this.#mode,rulesVersion:RULES.version,schemas:VERSIONS,
   objective:{targetLines:300,startLevel:1,maxLevel:30},pieceCap:this.#cap,lanes:this.#lanes,events:this.#events,finals,metadata:copy(metadata),
   archive:{incomplete:!!this.#archive,reason:this.#archive},assurance:'Canonical reducers conditional on the recorded initial state and observed piece sequence; no seed, provider, billing, or wall-clock authentication.',
   replay:'Stored visible frames only; zero new decisions'};
  const json=JSON.stringify(record);if(byteSize(record)>this.#limit.bytes)throw new Error('Canonical export byte limit reached');return json;
 }
}
