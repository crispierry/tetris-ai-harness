// Same-origin transport boundary, shared by the local server and owned fixture servers.
const MAX = 1048576;
const codes = new Set(['disabled','unavailable','unauthorized','overlap','input','epoch','revision','continuity','limit','budget','duplicate','collision','cancelled','transport_ambiguous','authentication','rate_limit','provider_error','refusal','schema','model_mismatch','size','unsupported_candidates','store_unavailable']);
export function createDecisionHandler({ service, host, origin } = {}) {
  if (!service || !/^127\.0\.0\.1:\d{1,5}$/.test(host ?? '') || origin !== `http://${host}`) throw new Error('configuration');
  return async (request, response) => {
    if (!['/decision/status','/decision/choice','/decision/control'].includes(request.url)) return false;
    response.setHeader('cache-control','no-store'); response.setHeader('content-type','application/json');
    response.setHeader('x-content-type-options','nosniff'); response.setHeader('content-security-policy',"default-src 'none'; frame-ancestors 'none'");
    const send = (status, body) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(status); response.end(JSON.stringify(body)); } };
    const critical = new Set(['host','origin','content-type','content-length','transfer-encoding','x-decision-capability']); const counts = {};
    for (let i=0;i<request.rawHeaders.length;i+=2) { const h = request.rawHeaders[i].toLowerCase(); if (critical.has(h) && (counts[h] = (counts[h] ?? 0)+1) > 1) { send(400,{error:'headers'}); return true; } }
    if (request.headers.host !== host) { send(403,{error:'host'}); return true; }
    if (request.url === '/decision/status') { if (request.method !== 'GET') send(405,{error:'method'}); else send(200,service.status()); return true; }
    if (request.method !== 'POST') { send(405,{error:'method'}); return true; }
    if (request.headers.origin !== origin) { send(403,{error:'origin'}); return true; }
    if (request.headers['content-type'] !== 'application/json') { send(415,{error:'media'}); return true; }
    if (request.headers['content-length'] && (!/^\d+$/.test(request.headers['content-length']) || Number(request.headers['content-length']) > MAX)) { send(413,{error:'size'}); request.resume(); return true; }
    const abort = new AbortController();
    // IncomingMessage close also fires after a healthy complete body on Node24. Never use it as disconnect.
    const disconnect = () => abort.abort();
    const responseClose = () => { if (!response.writableFinished) disconnect(); };
    request.on('aborted',disconnect); request.on('error',disconnect); response.on('close',responseClose);
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > MAX) { send(413,{error:'size'}); request.destroy(); return true; } chunks.push(chunk); }
      if (abort.signal.aborted) return true;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400,{error:'input'}); return true; }
      if (!body || Array.isArray(body) || typeof body !== 'object') { send(400,{error:'input'}); return true; }
      const cap = request.headers['x-decision-capability'];
      if (request.url === '/decision/choice') {
        if (Object.keys(body).length !== 1 || !Object.hasOwn(body,'packet')) { send(400,{error:'input'}); return true; }
        send(200,await service.decide(cap,body.packet,{signal:abort.signal}));
      } else {
        if (Object.keys(body).some(k => !['action','epoch'].includes(k))) { send(400,{error:'input'}); return true; }
        send(200,await service.control(cap,body.action,body.epoch));
      }
    } catch (e) { send(e.code === 'unauthorized' ? 403 : 400,{error:codes.has(e.code) ? e.code : 'unavailable'}); }
    finally { request.off('aborted',disconnect); request.off('error',disconnect); response.off('close',responseClose); }
    return true;
  };
}
