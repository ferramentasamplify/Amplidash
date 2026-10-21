import { handleMelhoresStateRequest } from '../../server/melhores-api.js';

export default async function handler(req, res) {
  const response = await handleMelhoresStateRequest(req);

  res.statusCode = response.status;
  Object.entries(response.headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.end(JSON.stringify(response.body));
}
