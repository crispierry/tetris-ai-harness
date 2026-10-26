import {browserPublicPolicy,validBrowserPolicy,validBrowserReceipt} from './browser-risk-contract.mjs';
import { freeze } from './harness.mjs';
const size=v=>new TextEncoder().encode(JSON.stringify(v)).length;
export function providerPolicy(provider) {
 let p;
 if(provider.kind==='remote') {
  const a=provider.runMetadata?.admission;
  if(a?.mode==='project-limit-browser'){const p=browserPublicPolicy(a);if(!validBrowserPolicy(p))throw new Error('Invalid browser policy');return freeze(JSON.parse(JSON.stringify(p)));}
  if(!a || !['http-fixture','live'].includes(a.mode) || a.provider!=='OpenAI' || a.requestedModel!=='gpt-6-luna' || a.endpoint!=='https://api.openai.com/v1/decisions' || a.protocol!=='decisions-http-1' || !/^[a-f0-9]{64}$/.test(a.policyDigest??''))throw new Error('Authenticated external policy required.');
  p={version:'provider-policy-1',kind:'externalDecisions',provider:'OpenAI',requestedModel:a.requestedModel,observedModel:a.observedModel,transport:a.mode,endpoint:a.endpoint,protocol:a.protocol,assistance:'canonical-afterstates-v1',visiblePreview:5,externalSearch:false,policyDigest:a.policyDigest,limits:a.limits,actualCostUSD:a.actualCostUSD};
 } else if(provider.runMetadata?.search) p={version:'provider-policy-1',kind:'localSearch',search:provider.runMetadata.search};
 else if(provider.kind==='mock') p={version:'provider-policy-1',kind:'mock',name:provider.name,fixture:provider.runMetadata};
 else p={version:'provider-policy-1',kind:'localHeuristic',policy:provider.runMetadata?.policy};
 if(size(p)>16384)throw new Error('Provider policy exceeds recording limit.');return freeze(JSON.parse(JSON.stringify(p)));
}
export function compactReceipt(receipt) {
 if(!receipt)return null;
 if(receipt.version==='decision-browser-receipt-1'){if(!validBrowserReceipt(receipt)||size(receipt)>4096)throw new Error('Invalid browser compact receipt');return freeze(JSON.parse(JSON.stringify(receipt)));}
 const allowed=['version','provider','requestedModel','observedModel','requestLatencyMs','completions','placements','actualExternalCalls','remainingAllowance','completedResponses','mode','runId','laneId','epoch','lineage','policyDigest','usage','estimatedReservationMicros','reservedInputTokens','requestId','stateRevision','selectedCandidateId','attempts','actualCostUSD','usageProvenance'];
 if(receipt.version!=='decision-receipt-2' || Object.keys(receipt).some(k=>!allowed.includes(k)) || !['http-fixture','live'].includes(receipt.mode) || receipt.provider!=='OpenAI' || receipt.requestedModel!=='gpt-6-luna' || !Number.isFinite(receipt.requestLatencyMs) || receipt.requestLatencyMs<0 || !['attempts','completedResponses','completions','placements'].every(k=>Number.isInteger(receipt[k])&&receipt[k]>=0&&receipt[k]<=1) || size(receipt)>4096)throw new Error('Invalid compact receipt.');
 return freeze(JSON.parse(JSON.stringify(receipt)));
}

// Local lookahead receipts are public bounded search accounting, not Decisions receipts.
export function localSearchReceipt(receipt) {
 if(!receipt)return null;
 if(receipt.version==='decision-browser-receipt-1'){if(!validBrowserReceipt(receipt)||size(receipt)>4096)throw new Error('Invalid browser compact receipt');return freeze(JSON.parse(JSON.stringify(receipt)));}
 const stats=['nodes','evaluatorCalls','rootsOffered','rootsCompleted','childrenEnumerated','leavesEvaluated','pruned','elapsedMs'];
 if(typeof receipt.requestId!=='string' || receipt.requestId.length>200 || !receipt.search || Object.keys(receipt.search).some(k=>!stats.includes(k)) || Object.values(receipt.search).some(v=>!Number.isFinite(v)||v<0))throw new Error('Invalid local search receipt.');
 const result={requestId:receipt.requestId,errorCode:receipt.errorCode,search:receipt.search,usage:null,actualCostUSD:null,provenance:'Local/mock leaf evaluations; no live model calls'};
 if(size(result)>4096)throw new Error('Local search receipt exceeds recording limit.');
 return freeze(JSON.parse(JSON.stringify(result)));
}
