import { connectLambda } from '@netlify/blobs';
import { handleMelhoresApplyRequest } from '../../server/melhores-api.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  connectLambda(event);
  const body = event.body ? JSON.parse(event.body) : {};
  const response = await handleMelhoresApplyRequest(body, event);

  return {
    statusCode: response.status,
    headers: response.headers,
    body: JSON.stringify(response.body),
  };
}
