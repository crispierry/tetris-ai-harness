import { RULES } from './engine.mjs';
import { VERSIONS, freeze } from './harness.mjs';
export const DECISION_RECORD_LIMITS=freeze({solo:{frames:2002,bytes:16*1024*1024},comparison:{frames:4000,bytes:16*1024*1024},versus:{frames:50000,bytes:64*1024*1024}});
export function decisionRecord({mode,policies,frames,finals,reasons,metadata={}}) {
 const limit=DECISION_RECORD_LIMITS[mode];if(!limit||!Array.isArray(frames)||frames.length>limit.frames)throw new Error('Recording frame limit reached.');
 if(!Array.isArray(policies)||policies.length>(mode==='solo'?1:2)||policies.some(p=>new TextEncoder().encode(JSON.stringify(p)).length>16384)||new TextEncoder().encode(JSON.stringify(metadata)).length>160*1024)throw new Error('Recording metadata limit reached.');
 for(const frame of frames){const receipt=frame?.decision?.receipt??frame?.lastDecision?.receipt;if(receipt&&new TextEncoder().encode(JSON.stringify(receipt)).length>4096)throw new Error('Recording receipt limit reached.');if(frame.pieces!==undefined&&(!Number.isInteger(frame.pieces)||frame.pieces<0||frame.pieces>1000))throw new Error('Recording placement limit reached.');}
 const record={version:'decision-ui-record-1',mode,rulesVersion:RULES.version,schemas:VERSIONS,objective:{targetLines:300,startLevel:1,maxLevel:30},policies,frames,finals,reasons,metadata,replay:'Stored visible frames only; zero new decisions'};
 const json=JSON.stringify(record);if(new TextEncoder().encode(json).length>limit.bytes)throw new Error('Recording byte limit reached.');return json;
}
