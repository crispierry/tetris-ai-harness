import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyDecisionUIRecord} from './decision-record-verifier.mjs';
const file=process.argv[2];
try{
 if(!file||process.argv.length!==3)throw new Error('Usage: node verify-decision-record.mjs <saved-record.json>');
 if((await stat(file)).size>64*1024*1024)throw new Error('Saved record exceeds 64 MiB');
 const bytes=await readFile(file),result=verifyDecisionUIRecord(bytes.toString('utf8'));
 console.log(JSON.stringify({file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,...result},null,2));
 if(!result.ok)process.exitCode=2;
}catch(error){console.error(JSON.stringify({file:file??null,ok:false,error:error.message}));process.exitCode=1;}
