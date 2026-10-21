import { json } from './melhores-auth.js';

// Native Request handlers retain Netlify's complete Blobs context, including the
// uncached endpoint required for strongly-consistent session/room reads.
export async function serve(request, handler, methods = ['GET', 'POST']) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!methods.includes(request.method)) return new Response(null, { status: 405, headers: { Allow: methods.join(', ') } });
  let response;
  try {
    const raw = request.method === 'POST' ? await request.text() : '';
    if (raw.length > 100000) response = json({ ok: false, error: 'Pedido muito grande.' }, 413);
    else {
      const body = raw ? JSON.parse(raw) : {};
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ ok: false, error: 'Pedido inválido.' }, { status: 400 });
      const headers = Object.fromEntries(request.headers);
      headers.host ||= new URL(request.url).host;
      response = await handler({ method: request.method, headers, body });
    }
  } catch (e) {
    console.error('[request]', e.message);
    response = json({ ok: false, error: 'Não foi possível processar o pedido.' }, e instanceof SyntaxError ? 400 : 503);
  }
  return new Response(JSON.stringify(response.body), { status: response.status, headers: response.headers });
}
