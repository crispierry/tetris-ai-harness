import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateDecisionNanos,createTestCostMeter} from '../public/test-cost.mjs';
const receipt=(requestId,usage)=>({version:'decision-browser-receipt-1',provider:'OpenAI',requestedModel:'gpt-6-luna',observedModel:'gpt-6-luna',requestLatencyMs:1,completions:1,placements:1,actualExternalCalls:null,remainingAllowance:{attempts:999},completedResponses:1,mode:'project-limit-browser',runId:'dummy',laneId:'right',epoch:0,lineage:'dummy',policyDigest:'a'.repeat(64),usage,estimatedReservationMicros:null,reservedInputTokens:null,requestId,stateRevision:1,selectedCandidateId:'candidate',attempts:1,actualCostUSD:null,usageProvenance:'Provider-reported dummy usage',accountingMode:'project-hard-limit-delay-risk',qualificationKind:'owner-risk-accepted-decisions-browser-1'});
const usage=(n,extra={})=>({input_tokens:n,output_tokens:50,total_tokens:n+50,...extra});
test('Decisions estimates replace ordinary input with cache reads/writes, ignore output and apply per-request long-context pricing',()=>{
 assert.equal(estimateDecisionNanos(receipt('ordinary',usage(1000))),100000n);
 assert.equal(estimateDecisionNanos(receipt('cache',usage(1000,{input_tokens_details:{cached_tokens:200,cache_write_tokens:300}}))),89500n);
 assert.equal(estimateDecisionNanos(receipt('aliases',usage(1000,{cache_read_input_tokens:200,cache_write_input_tokens:300}))),89500n);
 assert.equal(estimateDecisionNanos(receipt('long',usage(272001))),54400200n);
 assert.equal(estimateDecisionNanos(receipt('boundary',usage(272000))),27200000n);
 assert.equal(estimateDecisionNanos(receipt('conflict',usage(1000,{cached_input_tokens:200,cache_read_input_tokens:300}))),null);
 assert.equal(estimateDecisionNanos(receipt('overlap',usage(1000,{cached_input_tokens:900,cache_write_input_tokens:200}))),null);
 assert.equal(estimateDecisionNanos({...receipt('model',usage(1000)),observedModel:'other'}),null);
 assert.equal(estimateDecisionNanos({...receipt('snapshot',usage(1000)),observedModel:'gpt-6-luna-2026-10-01'}),100000n);
 assert.equal(estimateDecisionNanos({...receipt('model-suffix',usage(1000)),observedModel:'gpt-6-luna-other'}),null);
});
test('test subtotal deduplicates render/receipt, stays fixed during replay and clears only for a new game',()=>{
 const meter=createTestCostMeter(),state={gameId:'game-0',openAI:true},first=receipt('first',usage(1000));
 let cost=meter.update({...state,receipt:first});assert.equal(cost.estimatedUSD,0.0001);assert.equal(cost.decisions,1);
 cost=meter.update({...state,receipt:first});assert.equal(cost.decisions,1);assert.equal(cost.estimatedUSD,0.0001);
 cost=meter.update({...state,receipt:receipt('second',usage(1000))});assert.equal(cost.estimatedUSD,0.0002);
 cost=meter.update({...state,replay:true,gameId:'old-frame',receipt:first});assert.equal(cost.estimatedUSD,0.0002);assert.match(cost.text,/Recorded test cost/);
 cost=meter.update({...state,gameId:'game-1'});assert.equal(cost.estimatedUSD,0);assert.equal(cost.decisions,0);
 cost=meter.update({...state,gameId:'game-1',receipt:receipt('tiny',usage(1))});assert.match(cost.text,/<\$0.0001/);
});
test('unconnected, interrupted and malformed usage never masquerade as a complete free test',()=>{
 const meter=createTestCostMeter(),state={gameId:'game',openAI:true};
 assert.equal(meter.update({...state,tracked:false}).text,'Test cost unavailable');
 let cost=meter.update({...state,error:true});assert.equal(cost.text,'Test cost unavailable');assert.match(cost.note,/unknown/);
 cost=meter.update({...state,gameId:'new',receipt:receipt('first',usage(1000)),busy:true});assert.match(cost.note,/progress/);
 cost=meter.update({...state,gameId:'new',error:true});assert.equal(cost.estimatedUSD,0.0001);assert.match(cost.text,/partial/);
 cost=meter.update({...state,gameId:'invalid',receipt:receipt('bad',usage(1000,{cached_input_tokens:2000}))});assert.equal(cost.text,'Test cost unavailable');assert.equal(cost.estimatedUSD,null);
 for(const input_tokens_details of [null,0,'invalid',[]]){
  const malformed=receipt('bad-details',usage(1000,{input_tokens_details}));
  assert.equal(estimateDecisionNanos(malformed),null);
  assert.equal(meter.update({...state,gameId:'malformed-'+JSON.stringify(input_tokens_details),receipt:malformed}).text,'Test cost unavailable');
 }
});
