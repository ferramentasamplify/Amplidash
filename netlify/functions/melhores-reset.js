import { connectLambda } from '@netlify/blobs';
import { handleMelhoresResetRequest } from '../../server/melhores-api.js';

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
  const response = await handleMelhoresResetRequest(event);

  return {
    statusCode: response.status,
    headers: response.headers,
    body: JSON.stringify(response.body),
  };
}
