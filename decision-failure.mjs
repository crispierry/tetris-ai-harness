import {safeDecisionDiagnostic} from './public/decision-errors.mjs';
// The bounded message is private ledger evidence only. Public errors use the allowlisted projection.
export function decisionFailure({code,status,phase,body,requestId,elapsedMs,error,credential}={}){
 let message=typeof body?.error?.message==='string'?body.error.message:'';
 if(credential)message=message.split(credential).join('[redacted]');
 message=message.replace(/sk-[A-Za-z0-9_-]+|Bearer\s+\S+|proj_[A-Za-z0-9_-]+|[a-f0-9]{64}/gi,'[redacted]').replace(/[\u0000-\u001f]/g,' ').slice(0,1000);
 const transportCode=['ECONNRESET','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error?.cause?.code)?error.cause.code:null;
 const safeRequestId=typeof requestId==='string'&&((credential&&requestId.includes(credential))||/sk-|proj_|[a-f0-9]{64}/i.test(requestId))?null:requestId;
 return {public:safeDecisionDiagnostic({code,status,phase,providerCode:body?.error?.code,requestId:safeRequestId,elapsedMs}),message,transportCode};
}
