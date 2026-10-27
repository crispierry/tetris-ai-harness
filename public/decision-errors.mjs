// Safe public diagnostics: never display upstream messages, prompts, keys or headers.
const codes=new Set(['invalid_request_error','invalid_value','invalid_type','context_length_exceeded','rate_limit_exceeded','insufficient_quota','project_spend_limit_exceeded','organization_spend_limit_exceeded','server_error','authentication_error']);
const phases=new Set(['validation','dispatch','response','decode','commit']);
export function safeDecisionDiagnostic({code,status=null,phase,providerCode=null,requestId=null,elapsedMs=0}={}){
 return {version:'decision-error-1',code:typeof code==='string'&&/^[a-z_]{1,40}$/.test(code)?code:'transport_ambiguous',status:Number.isInteger(status)&&status>=100&&status<=599?status:null,phase:phases.has(phase)?phase:'dispatch',providerCode:codes.has(providerCode)?providerCode:null,requestId:typeof requestId==='string'&&/^req_[A-Za-z0-9_-]{1,120}$/.test(requestId)?requestId:null,elapsedMs:Math.min(60000,Math.max(0,Math.round(Number.isFinite(elapsedMs)?elapsedMs:0)))};
}
export function validDecisionDiagnostic(d){return !!d&&JSON.stringify(Object.keys(d).sort())===JSON.stringify(['version','code','status','phase','providerCode','requestId','elapsedMs'].sort())&&Object.entries(safeDecisionDiagnostic(d)).every(([k,v])=>d[k]===v);}
export function decisionErrorMessage(code,diagnostic){
 const d=validDecisionDiagnostic(diagnostic)?diagnostic:null;
 const reason={decision_timeout:'OpenAI decision deadline was exceeded',provider_error:d?.status>=500?'OpenAI service returned an error':'OpenAI rejected the request',transport_ambiguous:'OpenAI connection failed',authentication:'OpenAI authentication failed',unavailable:'OpenAI service is unavailable',quota_unknown:'OpenAI quota or rate limit blocked the request',project_budget_limit:'OpenAI project budget limit was reached',schema:'OpenAI returned an invalid decision response',model_mismatch:'OpenAI returned a different model',pilot_usage_required:'OpenAI usage details were missing or invalid',store_unavailable:'The local request ledger is unavailable',refusal:'OpenAI declined this decision',cancelled:'OpenAI request was cancelled',unsupported_candidates:'OpenAI Choice requires 2–255 legal placements'}[code];
 if(!reason)return code;
 return `${reason}${d?.status?` (HTTP ${d.status}${d.providerCode?`, ${d.providerCode}`:''})`:''}. No automatic retry was made.`;
}
