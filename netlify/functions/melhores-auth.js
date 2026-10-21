import { connectLambda } from '@netlify/blobs';
import { authRequest, json } from '../../server/melhores-auth.js';
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  connectLambda(event);
  let response;
  try {
    if ((event.body || '').length > 100000) response = json({ ok: false, error: 'Pedido muito grande.' }, 413);
    else response = await authRequest({ method: event.httpMethod, headers: event.headers, body: event.body ? JSON.parse(event.body) : {} });
  } catch { response = json({ ok: false, error: 'Pedido inválido.' }, 400); }
  return { statusCode: response.status, headers: response.headers, body: JSON.stringify(response.body) };
}
