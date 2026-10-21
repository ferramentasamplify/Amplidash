import { authRequest } from './server/melhores-auth.js';
import { roomRequest } from './server/melhores-room.js';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import {
  handleMelhoresApplyRequest,
  handleMelhoresSavesRequest,
  handleMelhoresResetRequest,
  handleMelhoresStateRequest,
} from './server/melhores-api.js';

const melhoresHtmlAliases = new Set([
  '/melhores',
  '/melhores/',
  '/melhores/index.html',
  '/src/melhores',
  '/src/melhores/',
  '/src/melhores/index.html',
]);

const dashCriadorHtmlAliases = new Set([
  '/dash_criador',
  '/dash_criador/',
  '/dash_criador/index.html',
  '/src/dash_criador',
  '/src/dash_criador/',
  '/src/dash_criador/index.html',
]);

const okrHtmlAliases = new Set([
  '/okr',
  '/okr/',
  '/okr/index.html',
  '/src/okr',
  '/src/okr/',
  '/src/okr/index.html',
]);

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, response) {
  res.statusCode = response.status;

  Object.entries(response.headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  res.end(JSON.stringify(response.body));
}

export default defineConfig({
  server: {
    port: 3000,
    open: false
  },
  plugins: [
    {
      name: 'melhores-dev-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const [pathname, search = ''] = (req.url || '').split('?');

          if (req.method === 'GET' && melhoresHtmlAliases.has(pathname)) {
            req.url = `/melhores/index.html${search ? `?${search}` : ''}`;
          }

          if (req.method === 'GET' && dashCriadorHtmlAliases.has(pathname)) {
            req.url = `/dash_criador/index.html${search ? `?${search}` : ''}`;
          }

          if (req.method === 'GET' && okrHtmlAliases.has(pathname)) {
            req.url = `/okr/index.html${search ? `?${search}` : ''}`;
          }

          if (req.method === 'OPTIONS' && pathname.startsWith('/api/melhores/')) {
            sendJson(res, {
              status: 204,
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
              },
              body: {},
            });
            return;
          }

          if (['/api/melhores/auth', '/api/melhores/room'].includes(pathname)) {
            try {
              const handler = pathname.endsWith('/auth') ? authRequest : roomRequest;
              sendJson(res, await handler({ method: req.method, headers: req.headers, body: req.method === 'POST' ? await readJsonBody(req) : {} }));
            } catch { sendJson(res, { status: 400, headers: {}, body: { ok: false, error: 'Pedido inválido.' } }); }
            return;
          }

          if (pathname === '/api/melhores/saves' && ['GET', 'POST'].includes(req.method)) {
            sendJson(res, await handleMelhoresSavesRequest(req.method === 'POST' ? await readJsonBody(req) : {}, req.method, req));
            return;
          }

          if (pathname === '/api/melhores/state' && req.method === 'GET') {
            sendJson(res, await handleMelhoresStateRequest(req));
            return;
          }

          if (pathname === '/api/melhores/apply' && req.method === 'POST') {
            const body = await readJsonBody(req);
            sendJson(res, await handleMelhoresApplyRequest(body, req));
            return;
          }

          if (pathname === '/api/melhores/reset' && req.method === 'POST') {
            sendJson(res, await handleMelhoresResetRequest(req));
            return;
          }

          next();
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        melhores: resolve(__dirname, 'melhores/index.html'),
        dash_criador: resolve(__dirname, 'dash_criador/index.html'),
        okr: resolve(__dirname, 'okr/index.html'),
      }
    }
  }
});
