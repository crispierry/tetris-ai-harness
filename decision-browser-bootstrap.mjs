import path from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {readPrivateOwnerFile,parseDecisionCredential,decisionStartupMode} from './decision-bootstrap.mjs';
import {qualifiedDecisionBrowser} from './decision-browser-qualification.mjs';
import {createDecisionBrowserService} from './decision-browser-service.mjs';
import {openDecisionStore,digest} from './decision-store.mjs';
export const DEFAULT_BROWSER_DECISION_KEY_FILE=path.join(homedir(),'.config/tetris-ai-harness/openai.browser.env');
const reject=()=>{throw Object.assign(new Error('decision_browser_startup_rejected'),{code:'decision_browser_startup_rejected'});};
export async function readBrowserDecisionCredential(){return parseDecisionCredential(await readPrivateOwnerFile(DEFAULT_BROWSER_DECISION_KEY_FILE,1024));}
// Injection is only for disposable offline dummy fixtures; server supplies none.
export async function bootstrapBrowserDecisionService({args,readConfig=async file=>JSON.parse(await readPrivateOwnerFile(file,65536)),loadCredential=readBrowserDecisionCredential,openStore=openDecisionStore,fetchImpl=globalThis.fetch}={}){
 let store;try{const startup=decisionStartupMode(args??[]);if(startup.mode!=='browser')return null;const c=await readConfig(startup.config);
 if(!c||Object.keys(c).sort().join(',')!=='directory,lineage,policy,qualification'||!path.isAbsolute(c.directory??'')||!/^[A-Za-z0-9_-]{1,80}$/.test(c.lineage??'')||!qualifiedDecisionBrowser(c.qualification,c.policy))reject();
 store=await openStore({directory:c.directory,lineage:c.lineage,policy:c.policy,enroll:startup.enroll});if(store.snapshot().policyDigest!==digest(c.policy)||!qualifiedDecisionBrowser(c.qualification,c.policy))reject();
 const credential=await loadCredential();if(typeof credential!=='string'||createHash('sha256').update(credential,'utf8').digest('hex')!==c.qualification.projectEvidence.keyFingerprint)reject();return await createDecisionBrowserService({store,policy:c.policy,qualification:c.qualification,credential,fetchImpl});
 }catch{try{await store?.close();}catch{}reject();}
}
