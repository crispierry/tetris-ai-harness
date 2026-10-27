import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
import {stateFromObservation} from '../public/ai-gravity.mjs';
import {enumerate,candidateEvidence} from '../public/harness.mjs';
import {holeConsequences} from '../decision-compact.mjs';
const root=new URL('../docs/research/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
for(const entry of manifest.records)test(`preserved research record: ${entry.file}`,()=>{
 const raw=readFileSync(new URL(entry.file,root));assert.equal(raw.length,entry.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256);
 const result=verifyDecisionUIRecord(raw.toString());assert.equal(result.ok,true);assert.equal(result.canonical,true);
 const record=JSON.parse(raw),expected=entry.file==='factual-run.json'?[300,125]:entry.file==='hole-priority-run.json'?[300,92]:[300,5];
 assert.deepEqual(record.finals.map(f=>f.observation.lines),expected);
 assert.equal(result.archiveIncomplete,false);
 if(entry.file==='hole-priority-run.json'){
  let before=record.lanes.find(l=>l.id===1).initial.observation,checked=0;
  for(const event of record.events.filter(e=>e.lane===1)){
   if([106,111].includes(event.pieces)&&event.input.kind==='gravity'&&event.input.outcome==='placed'){
    const state=stateFromObservation(before),binding={sessionId:before.sessionId,revision:before.revision};
    const candidates=enumerate(state,binding).map(c=>candidateEvidence(state,c,binding)),selected=candidates.find(c=>c.id===event.input.selectedCandidateId);
    assert(selected);assert.equal(selected.features.maxHeight,4);assert.equal(selected.piece,event.pieces===106?'L':'O');
    assert(holeConsequences(state.board,selected.afterstate.board,selected.clearedRows).created>0);
    assert(candidates.some(c=>c.afterstate.status!=='over'&&holeConsequences(state.board,c.afterstate.board,c.clearedRows).created===0));
    checked++;
   }
   before=event.observation;
  }
  assert.equal(checked,2,'both early decision examples are reconstructible');
 }
});
