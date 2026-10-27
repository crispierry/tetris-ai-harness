import {validBrowserReceipt} from './browser-risk-contract.mjs';

// Display estimate only. Never changes actualCostUSD, provider admission or budgets.
export const COST_SOURCE='https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability';
export const COST_BASIS='USD, standard global Decisions pricing checked Oct 26, 2026. Per million input tokens: $0.10 ordinary, $0.01 cache reads, $0.125 default 30-minute cache writes. Cache counts replace ordinary tokens; output is free. Requests over 272,000 input tokens use 2× input rates. Billing premiums/adjustments and failed requests may add charges. This is not an invoice.';
const alias=(values)=>{const present=values.filter(v=>v!==undefined);return present.length&&present.some(v=>v!==present[0])?null:present[0]??0;};
export function estimateDecisionNanos(receipt){
 if(!validBrowserReceipt(receipt)||receipt.observedModel!=='gpt-6-luna')return null;
 const u=receipt.usage,read=alias([u.cached_input_tokens,u.cache_read_input_tokens,u.input_tokens_details?.cached_tokens]),write=alias([u.cache_write_input_tokens,u.input_tokens_details?.cache_write_tokens]);
 if(read===null||write===null||read+write>u.input_tokens)return null;
 return (BigInt(u.input_tokens-read-write)*100n+BigInt(read)*10n+BigInt(write)*125n)*(u.input_tokens>272000?2n:1n);
}
const usd=new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',minimumFractionDigits:4,maximumFractionDigits:4});
export function createTestCostMeter(){
 let game=null,total=0n,partial=false,unknown=false,seen=new Set();
 return {update({gameId,receipt,error=false,busy=false,replay=false,openAI=false,tracked=true}={}){
  if(!replay&&gameId!==game){game=gameId;total=0n;partial=false;unknown=false;seen.clear();}
  if(!replay&&openAI){
   if(error)partial=true;
   if(receipt&&!seen.has(receipt.requestId)){
    seen.add(receipt.requestId);const nanos=estimateDecisionNanos(receipt);if(nanos===null){unknown=true;partial=true;}else total+=nanos;
   }
  }
  const unavailable=!tracked||unknown||(partial&&seen.size===0),amount=total>0n&&total<100000n?'<$0.0001':usd.format(Number(total)/1e9);
  return Object.freeze({text:!openAI?'OpenAI cost $0 · Local run':unavailable?'Test cost unavailable':`${replay?'Recorded test cost':'Test cost'} (est.${partial?', partial':''}) ${amount}`,note:openAI&&(partial||unknown)?'Some request costs are unknown.':openAI&&busy?'Request in progress; estimate may increase.':'',estimatedUSD:openAI&&!unavailable?Number(total)/1e9:null,partial,decisions:seen.size});
 }};
}
export function mountTestCost(doc){
 const meter=createTestCostMeter();return state=>{const value=meter.update(state),cost=doc.getElementById('decision-cost'),note=doc.getElementById('decision-cost-note');if(cost){cost.hidden=!state.openAI;cost.textContent=value.text;}if(note){note.hidden=!value.note||!state.openAI;note.textContent=value.note;}return value;};
}
