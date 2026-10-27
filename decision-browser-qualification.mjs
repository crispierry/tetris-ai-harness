import {digest} from './decision-store.mjs';
export const BROWSER_QUALIFICATION_KIND='owner-risk-accepted-decisions-browser-1';
export const BROWSER_MODE='project-limit-browser';
export const BROWSER_LIMITS=Object.freeze({maxAttempts:1000,maxRuns:64,maxEpochs:100,maxPlacements:1000,maxConcurrentUpstream:1,windowMs:3600000,timeoutMs:1500,retryLimit:0,fallback:'none'});
export const BROWSER_SPEND=Object.freeze({configuredProjectLimitUSD:1,enforcementDelayOvershoot:'unquantified',riskAccepted:true});
const exact=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...fields].sort().join(',');
const positive=n=>Number.isSafeInteger(n)&&n>0;
export function qualifiedDecisionBrowser(q,p,now=Date.now()){
 if(!exact(q,['kind','model','endpoint','method','requestSchema','maxBodyBytes','maxResponseBytes','activationStartedAt','riskAcceptance','projectEvidence'])||!exact(p,['kind','qualificationDigest','maxAttempts','maxRuns','maxEpochs','maxPlacements','maxConcurrentUpstream','timeoutMs','expiresAt','retryLimit','fallback']))return false;
 const e=q.projectEvidence,a=q.riskAcceptance;
 if(q.kind!==BROWSER_QUALIFICATION_KIND||q.model!=='gpt-6-luna'||q.endpoint!=='https://api.openai.com/v1/decisions'||q.method!=='POST'||q.requestSchema!=='decisions-create-fixed-1'||q.maxBodyBytes!==1048576||q.maxResponseBytes!==65536||!positive(q.activationStartedAt)||q.activationStartedAt>now||!positive(p.expiresAt)||p.expiresAt<=now||p.expiresAt>q.activationStartedAt+3600000)return false;
 if(!exact(e,['projectId','keyFingerprint','keyProjectBindingVerified','thresholdAmountCents','currency','interval','enforcementStatus','checkedAt','evidenceReference','keyExpiresAt'])||typeof e.projectId!=='string'||!/^proj_[A-Za-z0-9_-]{1,120}$/.test(e.projectId)||!/^[a-f0-9]{64}$/.test(e.keyFingerprint??'')||e.keyProjectBindingVerified!==true||![100,500].includes(e.thresholdAmountCents)||e.currency!=='USD'||e.interval!=='month'||e.enforcementStatus!=='enforcing'||!positive(e.checkedAt)||e.checkedAt>q.activationStartedAt||q.activationStartedAt-e.checkedAt>900000||!positive(e.keyExpiresAt)||p.expiresAt>e.keyExpiresAt||typeof e.evidenceReference!=='string'||e.evidenceReference.length<1||e.evidenceReference.length>500)return false;
 if(!exact(a,['acceptedBy','acceptedAt','evidenceReference','riskCode'])||a.acceptedBy!=='Cris'||a.riskCode!=='unquantified-project-hard-limit-enforcement-delay'||!positive(a.acceptedAt)||a.acceptedAt>q.activationStartedAt||typeof a.evidenceReference!=='string'||a.evidenceReference.length<1||a.evidenceReference.length>500)return false;
 return p.kind==='risk-accepted-project-browser-policy-1'&&p.qualificationDigest===digest(q)&&Object.entries(BROWSER_LIMITS).filter(([k])=>k!=='windowMs').every(([k,v])=>p[k]===v);
}
