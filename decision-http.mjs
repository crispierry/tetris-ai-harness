import {validDecisionDiagnostic} from './public/decision-errors.mjs';
// Same-origin transport boundary, shared by the local server and owned fixture servers.
const MAX = 1048576;
const codes = new Set(['decision_timeout','disabled','unavailable','unauthorized','overlap','input','epoch','revision','continuity','limit','budget','duplicate','collision','cancelled','transport_ambiguous','authentication','rate_limit','provider_error','refusal','schema','model_mismatch','size','unsupported_candidates','store_unavailable','reconciliation_required','session_request_limit','session_expired','project_budget_limit','quota_unknown','pilot_usage_required']);
export function createDecisionHandler({ service, host, origin, owner } = {}) {
  if (!service || !/^127\.0\.0\.1:\d{1,5}$/.test(host ?? '') || origin !== `http://${host}`) throw new Error('configuration');
  return async (request, response) => {
    if (!['/decision/status','/decision/choice','/decision/control','/decision/pair/register','/decision/pair/claim'].includes(request.url)) return false;
    response.setHeader('cache-control','no-store'); response.setHeader('content-type','application/json');
    response.setHeader('x-content-type-options','nosniff'); response.setHeader('content-security-policy',"default-src 'none'; frame-ancestors 'none'");
    const send = (status, body) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(status); response.end(JSON.stringify(body)); } };
    const critical = new Set(['host','origin','content-type','content-length','transfer-encoding','x-decision-capability','x-decision-pairing-nonce']); const counts = {};
    for (let i=0;i<request.rawHeaders.length;i+=2) { const h = request.rawHeaders[i].toLowerCase(); if (critical.has(h) && (counts[h] = (counts[h] ?? 0)+1) > 1) { send(400,{error:'headers'}); return true; } }
    if (request.headers.host !== host) { send(403,{error:'host'}); return true; }
    if (request.url === '/decision/status') { if (request.method !== 'GET') send(405,{error:'method'}); else send(200,service.status()); return true; }
    if (request.method !== 'POST') { send(405,{error:'method'}); return true; }
    if (request.headers.origin !== origin) { send(403,{error:'origin'}); return true; }
    if (request.headers['content-type'] !== 'application/json') { send(415,{error:'media'}); return true; }
    if (request.headers['content-length'] && (!/^\d+$/.test(request.headers['content-length']) || Number(request.headers['content-length']) > MAX)) { send(413,{error:'size'}); request.resume(); return true; }
    const maximum=request.url.startsWith('/decision/pair/')?4096:MAX;
    const abort = new AbortController();
    // IncomingMessage close also fires after a healthy complete body on Node24. Never use it as disconnect.
    const disconnect = () => abort.abort();
    const responseClose = () => { if (!response.writableFinished) disconnect(); };
    request.on('aborted',disconnect); request.on('error',disconnect); response.on('close',responseClose);
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > maximum) { send(413,{error:'size'}); request.destroy(); return true; } chunks.push(chunk); }
      if (abort.signal.aborted) return true;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400,{error:'input'}); return true; }
      if (!body || Array.isArray(body) || typeof body !== 'object') { send(400,{error:'input'}); return true; }
      if(request.url.startsWith('/decision/pair/')) {
        if(!owner) {send(400,{error:'unavailable'});return true;}
        send(200,request.url.endsWith('/register')?await owner.register(body):await owner.claim(body,request.headers['x-decision-pairing-nonce']));return true;
      }
      const cap = request.headers['x-decision-capability'];
      if (request.url === '/decision/choice') {
        if (Object.keys(body).some(k=>!['packet',...(service.browserRisk?['gravity']:[])].includes(k)) || !Object.hasOwn(body,'packet') || (Object.hasOwn(body,'gravity')&&body.gravity!==true)) { send(400,{error:'input'}); return true; }
        send(200,await service.decide(cap,body.packet,{signal:abort.signal,gravity:body.gravity===true}));
      } else {
        if ((['proof','observation'].some(k=>Object.hasOwn(body,k))&&body.action!=='settleGravity') || Object.keys(body).some(k => !['action','epoch',...(service.browserRisk?['requestId','proof','observation']:[])].includes(k)) || (Object.hasOwn(body,'requestId')&&!['acceptDecision','interrupt','settleGravity'].includes(body.action))) { send(400,{error:'input'}); return true; }
        send(200,await service.control(cap,body.action,body.epoch,service.browserRisk?{requestId:body.requestId,proof:body.proof,observation:body.observation}:undefined));
      }
    } catch (e) { send(e.code === 'unauthorized' ? 403 : 400,{error:codes.has(e.code) ? e.code : 'unavailable',...(service.browserRisk&&validDecisionDiagnostic(e.diagnostic)?{diagnostic:e.diagnostic}:{})}); }
    finally { request.off('aborted',disconnect); request.off('error',disconnect); response.off('close',responseClose); }
    return true;
  };
}
