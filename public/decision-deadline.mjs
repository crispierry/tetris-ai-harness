// The backend owns the upstream deadline. Leave room for local control reads,
// response delivery and a structured timeout instead of racing its abort timer.
export function decisionDeadline(provider, localMs) {
 const a=provider.kind==='remote'?provider.runMetadata?.admission:null;
 const ms=a?.limits?.timeoutMs;
 if(a?.mode==='project-limit-browser'&&Number.isInteger(ms)&&ms>=1&&ms<=10000)
  return {requestMs:ms,waitMs:ms+2000};
 return {requestMs:localMs,waitMs:localMs};
}
