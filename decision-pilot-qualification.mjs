// Explicit owner-approved project-limit pilot. No token ceiling is asserted.
import {digest} from './decision-store.mjs';
export const PILOT_KIND='owner-risk-accepted-decisions-pilot-1';
export const PILOT_MODE='project-limit-pilot';
export const PILOT_DISCLOSURE='Project limit is $1 USD; billing enforcement may be delayed. This is not a guaranteed $1 cost ceiling. Actual billing is unknown.';
const exact=(o,fields)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...fields].sort().join(',');
const positive=n=>Number.isSafeInteger(n)&&n>0;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function qualifiedDecisionPilot(q,p,now=Date.now()){
 if(!exact(q,['kind','model','endpoint','method','requestSchema','maxBodyBytes','maxResponseBytes','pilotStartedAt','projectEvidence','riskAcceptance'])||!exact(p,['kind','qualificationDigest','maxAttempts','maxRuns','maxEpochs','maxPlacements','maxConcurrentUpstream','expiresAt','timeoutMs','retryLimit','fallback']))return false;
 const e=q.projectEvidence,a=q.riskAcceptance;
 if(q.kind!==PILOT_KIND||q.model!=='gpt-6-luna'||q.endpoint!=='https://api.openai.com/v1/decisions'||q.method!=='POST'||q.requestSchema!=='decisions-create-fixed-1'||q.maxBodyBytes!==1048576||q.maxResponseBytes!==65536||!positive(q.pilotStartedAt)||q.pilotStartedAt>now||!positive(p.expiresAt)||p.expiresAt>q.pilotStartedAt+60000||now>=p.expiresAt)return false;
 if(!exact(e,['projectId','keyFingerprint','keyProjectBindingVerified','thresholdAmountCents','currency','interval','enforcementStatus','checkedAt','evidenceReference'])||typeof e.projectId!=='string'||!/^proj_[A-Za-z0-9_-]{1,120}$/.test(e.projectId)||!hash(e.keyFingerprint)||e.keyProjectBindingVerified!==true||e.thresholdAmountCents!==100||e.currency!=='USD'||e.interval!=='month'||e.enforcementStatus!=='enforcing'||!positive(e.checkedAt)||e.checkedAt>q.pilotStartedAt||q.pilotStartedAt-e.checkedAt>900000||typeof e.evidenceReference!=='string'||e.evidenceReference.length<1||e.evidenceReference.length>500)return false;
 if(!exact(a,['acceptedBy','acceptedAt','evidenceReference','riskCode'])||a.acceptedBy!=='Cris'||a.riskCode!=='unquantified-project-hard-limit-enforcement-delay'||!positive(a.acceptedAt)||a.acceptedAt>q.pilotStartedAt||typeof a.evidenceReference!=='string'||a.evidenceReference.length<1||a.evidenceReference.length>500)return false;
 return p.kind==='risk-accepted-project-pilot-policy-1'&&p.qualificationDigest===digest(q)&&p.maxAttempts===3&&p.maxRuns===1&&p.maxEpochs===1&&p.maxPlacements===3&&p.maxConcurrentUpstream===1&&p.timeoutMs===1500&&p.retryLimit===0&&p.fallback==='none';
}
export function pilotPublicPolicy(policy,policyDigest){return {version:'provider-policy-pilot-1',kind:'externalDecisions',provider:'OpenAI',requestedModel:'gpt-6-luna',observedModel:null,transport:PILOT_MODE,endpoint:'https://api.openai.com/v1/decisions',protocol:'decisions-http-1',assistance:'canonical-afterstates-v1',visiblePreview:5,externalSearch:false,policyDigest,qualificationKind:'owner-risk-accepted-decisions-pilot-1',accountingMode:'project-hard-limit-delay-risk',limits:{maxAttempts:3,maxRuns:1,maxEpochs:1,maxPlacements:3,maxConcurrentUpstream:1,windowMs:60000,timeoutMs:1500,retryLimit:0,fallback:'none'},spendControl:{configuredProjectLimitUSD:1,enforcementDelayOvershoot:'unquantified',riskAccepted:true},actualCostUSD:null};}
export function pilotUsage(raw){
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 if(!exact(raw,Object.keys(raw??{}))||!['input_tokens','output_tokens','total_tokens'].every(k=>integer(raw[k]))||raw.total_tokens!==raw.input_tokens+raw.output_tokens)throw Object.assign(new Error('pilot_usage_required'),{code:'pilot_usage_required'});
 const result={input_tokens:raw.input_tokens,output_tokens:raw.output_tokens,total_tokens:raw.total_tokens};
 for(const k of ['cached_input_tokens','cache_read_input_tokens','cache_write_input_tokens'])if(raw[k]!==undefined){if(!integer(raw[k])||raw[k]>raw.input_tokens)throw Object.assign(new Error('pilot_usage_required'),{code:'pilot_usage_required'});result[k]=raw[k];}
 if(raw.input_tokens_details!==undefined){const d=raw.input_tokens_details;if(!d||typeof d!=='object'||Array.isArray(d))throw Object.assign(new Error('pilot_usage_required'),{code:'pilot_usage_required'});const details={};for(const k of ['cached_tokens','cache_write_tokens'])if(d[k]!==undefined){if(!integer(d[k])||d[k]>raw.input_tokens)throw Object.assign(new Error('pilot_usage_required'),{code:'pilot_usage_required'});details[k]=d[k];}if(Object.keys(details).length)result.input_tokens_details=details;}
 return result;
}
