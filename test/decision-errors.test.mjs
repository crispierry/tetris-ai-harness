import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionFailure} from '../decision-failure.mjs';
import {safeDecisionDiagnostic,validDecisionDiagnostic,decisionErrorMessage} from '../public/decision-errors.mjs';
test('public diagnostics distinguish a provider rejection, service error and real deadline without raw text',()=>{
 const d=safeDecisionDiagnostic({code:'provider_error',status:400,providerCode:'invalid_request_error',requestId:'req_test',phase:'decode',elapsedMs:174.3});
 assert(validDecisionDiagnostic(d));assert(validDecisionDiagnostic(Object.fromEntries(Object.entries(d).reverse())));assert.match(decisionErrorMessage(d.code,d),/rejected.*HTTP 400, invalid_request_error/);assert.match(decisionErrorMessage('provider_error',{...d,status:503}),/service returned an error/);assert.match(decisionErrorMessage('decision_timeout'),/deadline/);assert.match(decisionErrorMessage('transport_ambiguous'),/connection failed/);assert.equal(validDecisionDiagnostic({...d,rawMessage:'untrusted'}),false);
});
test('private messages redact secrets and public fields reject tainted request IDs and arbitrary error strings',()=>{
 const credential='sk-proj-dummy_secret_only',fingerprint='a'.repeat(64),failure=decisionFailure({code:'provider_error',status:400,phase:'decode',elapsedMs:3,credential,requestId:'req_'+credential,body:{error:{code:'sk-proj-private',message:credential+' '+fingerprint+' proj_private\n'+'x'.repeat(2000)}}});
 const json=JSON.stringify(failure);for(const secret of [credential,fingerprint,'proj_private','sk-proj-private'])assert(!json.includes(secret));assert.equal(failure.public.requestId,null);assert.equal(failure.public.providerCode,null);assert(failure.message.length<=1000);assert(validDecisionDiagnostic(failure.public));
});
