// Foreground-only pilot entry point. No browser, HTTP listener, retry or fallback.
import {lstat,open,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readPrivateOwnerFile,readDecisionCredential} from './decision-bootstrap.mjs';
import {qualifiedDecisionPilot,pilotPublicPolicy} from './decision-pilot-qualification.mjs';
import {openDecisionStore,digest} from './decision-store.mjs';
import {createDecisionPilotService} from './decision-service.mjs';
import {Controller} from './public/controller.mjs';
import {DecisionJournal} from './public/decision-record.mjs';
import {verifyDecisionUIRecord} from './decision-record-verifier.mjs';
export const PILOT_OPENING=Object.freeze([
 'Native Decisions pilot: owner-approved, risk accepted.',
 'Authorization: up to 3 requests in a 60-second dispatch window, sent one at a time. No automatic retries.',
 'Configured project budget: USD 1.00. Provider billing may be delayed; a USD 1.00 charged-cost ceiling is not guaranteed.',
 'Input-token ceiling: Unverified. Measured billing: Unknown.'
]);
const reject=()=>{throw Object.assign(new Error('decision_pilot_startup_rejected'),{code:'decision_pilot_startup_rejected'});};
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...k].sort().join(',');
async function outputFile(file){
 if(!path.isAbsolute(file??''))reject();let at=path.parse(file).root;
 for(const part of path.dirname(file).slice(at.length).split('/').filter(Boolean)){at=path.join(at,part);const s=await lstat(at);if(!s.isDirectory()||s.isSymbolicLink())reject();}
 const parent=await lstat(path.dirname(file));if(parent.uid!==process.getuid()||(parent.mode&0o7777)!==0o700)reject();
 return open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
}
/** Injectable loaders/transports are for disposable dummy fixtures; CLI supplies none. */
export async function runDecisionPilot({configFile,enroll=false,readConfig=async file=>JSON.parse(await readPrivateOwnerFile(file,65536)),loadCredential=readDecisionCredential,openStore=openDecisionStore,fetchImpl=globalThis.fetch,onOpening=()=>{},signal}={}){
 let store,service,recordHandle,manifestHandle,controller,journal,capability,config,accounting=null,verification=null,recordHash=null,drained=false;
 let stopReason='startup_rejected';const executionStartedAt=Date.now();
 try{
  config=await readConfig(configFile);
  if(!exact(config,['directory','lineage','policy','qualification','recordFile','manifestFile'])||!path.isAbsolute(config.directory??'')||!/^[A-Za-z0-9_-]{1,80}$/.test(config.lineage??'')||config.recordFile===config.manifestFile||!qualifiedDecisionPilot(config.qualification,config.policy))reject();
  config=structuredClone(config);
  // Policy, private output destinations and durable aggregate are checked before key loading.
  recordHandle=await outputFile(config.recordFile);manifestHandle=await outputFile(config.manifestFile);
  store=await openStore({directory:config.directory,lineage:config.lineage,policy:config.policy,enroll});
  if(!qualifiedDecisionPilot(config.qualification,config.policy)||store.snapshot().policyDigest!==digest(config.policy))reject();
  const credential=await loadCredential();
  if(createHash('sha256').update(credential,'utf8').digest('hex')!==config.qualification.projectEvidence.keyFingerprint)reject();
  service=createDecisionPilotService({store,policy:config.policy,qualification:config.qualification,credential,fetchImpl});
  const grant=await service.owner.issueRun({laneId:'pilot',controllerSessionBase:'pilot'});capability=grant.capability;
  let lastReceipt=null;const publicPolicy=pilotPublicPolicy(config.policy,store.snapshot().policyDigest);
  const provider={name:'Native Decisions pilot',kind:'pilot',version:'decisions-project-pilot-1',capabilities:{maxCandidates:255,movementMode:'reachable-paused-gravity-v1',assistance:'canonical-afterstates-v1'},
   get lastReceipt(){return lastReceipt;},async decide(packet,{signal}={}){lastReceipt=null;const result=await service.decide(capability,packet,{signal});lastReceipt=result.receipt;return result.choice;}};
  journal=new DecisionJournal({mode:'solo',pieceCap:3});
  controller=new Controller({sessionId:'pilot',provider,deadlineMs:1500,onTransition:({input,view})=>journal.append(0,input.kind==='computer'?{...input,receipt:lastReceipt}:input,view)});
  journal.addLane(0,'computer',controller.view,publicPolicy);
  onOpening(PILOT_OPENING);
  const abort=()=>controller.pause();signal?.addEventListener('abort',abort,{once:true});
  try{
   for(let n=0;n<3;n++){
    if(signal?.aborted){stopReason='cancelled';break;}
    if(Date.now()>=config.policy.expiresAt){stopReason='pilot_expired';break;}
    await controller.step();
    if(controller.view.status==='error'){stopReason='decision_failed';break;}
    if(['won','over'].includes(controller.view.status)){stopReason=controller.view.status;break;}
    stopReason=controller.view.pieces===3?'placement_cap':'incomplete';
   }
  }finally{signal?.removeEventListener('abort',abort);}
 }catch{stopReason=service?'decision_pilot_failed':'decision_pilot_startup_rejected';}
 finally{
  if(service&&capability){try{accounting=await service.control(capability,'runStatus');}catch{stopReason='accounting_unavailable';}}
  if(journal&&recordHandle){try{
   const json=journal.exportRun({metadata:{accounting}});await recordHandle.writeFile(json);await recordHandle.sync();await recordHandle.close();recordHandle=null;
   const bytes=await readFile(config.recordFile);recordHash=createHash('sha256').update(bytes).digest('hex');verification=verifyDecisionUIRecord(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{stopReason='record_verification_failed';}}
  if(service){try{await service.close();drained=true;}catch{stopReason='drain_pending';}}
  else if(store){try{await store.close();drained=true;}catch{stopReason='store_close_failed';}}
  if(manifestHandle){try{
   const snapshot=store?.snapshot();
   const manifest={version:'decision-private-pilot-manifest-1',opening:PILOT_OPENING,accountingMode:'project-hard-limit-delay-risk',spendControl:{configuredProjectLimitUSD:1,enforcementDelayOvershoot:'unquantified',riskAccepted:true},pilotStartedAt:config.qualification.pilotStartedAt,executionStartedAt,finishedAt:Date.now(),lineage:config.lineage,qualificationDigest:digest(config.qualification),policyDigest:digest(config.policy),stopReason,drained,attempts:snapshot?.used.attempts??0,completedResponses:Object.values(snapshot?.requests??{}).filter(r=>r.status==='completed').length,uncertain:Object.values(snapshot?.requests??{}).filter(r=>['uncertain','dispatch-intent'].includes(r.status)).length,placements:controller?.view.pieces??0,actualExternalCalls:null,actualCostUSD:null,reservedInputTokens:null,estimatedReservationMicros:null,recordSHA256:recordHash,canonicalVerification:verification};
   await manifestHandle.writeFile(JSON.stringify(manifest,null,2));await manifestHandle.sync();
  }catch{stopReason='manifest_write_failed';}}
  await recordHandle?.close();await manifestHandle?.close();
 }
 return {ok:!!verification?.ok&&drained&&['placement_cap','won','over'].includes(stopReason),stopReason,verification,recordSHA256:recordHash,accounting};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),config=args.find(a=>a.startsWith('--config='))?.slice(9);
 if(!config||args.some(a=>!a.startsWith('--config=')&&a!=='--enroll')||args.filter(a=>a.startsWith('--config=')).length!==1||args.filter(a=>a==='--enroll').length>1){console.error('Usage: node decision-pilot-runner.mjs --config=/absolute/private/config.json [--enroll]');process.exitCode=1;}
 else{const abort=new AbortController(),interrupt=()=>abort.abort();process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);try{const result=await runDecisionPilot({configFile:config,enroll:args.includes('--enroll'),signal:abort.signal,onOpening:lines=>lines.forEach(line=>console.log(line))});console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}}
}
