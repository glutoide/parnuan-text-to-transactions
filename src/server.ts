import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMessage } from './parser.ts';
import { confirmTransactions } from './review.ts';

const MAX_BODY_BYTES = 32_000;
const MAX_TEXT_CHARS = 2_000;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body is too large');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function serveStatic(res: ServerResponse, path: string, contentType: string): Promise<void> {
  try {
    const content = await readFile(join(ROOT, 'public', path));
    res.writeHead(200, { 'content-type': contentType, 'content-length': content.length });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && url.pathname === '/api/parse') {
        const body = await readJson(req);
        if (typeof body.text !== 'string') throw new HttpError(400, 'text must be a string');
        if (body.text.length > MAX_TEXT_CHARS) throw new HttpError(413, `text must be at most ${MAX_TEXT_CHARS} characters`);
        return sendJson(res, 200, parseMessage(body.text));
      }

      if (method === 'POST' && url.pathname === '/api/confirm') {
        const body = await readJson(req);
        return sendJson(res, 200, confirmTransactions(body.transactions));
      }

      if (method === 'GET' && url.pathname === '/') return await serveStatic(res, 'index.html', 'text/html; charset=utf-8');
      if (method === 'GET' && url.pathname === '/app.js') return await serveStatic(res, 'app.js', 'text/javascript; charset=utf-8');
      if (method === 'GET' && url.pathname === '/styles.css') return await serveStatic(res, 'styles.css; charset=utf-8');

      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      if (error instanceof TypeError) return sendJson(res, 400, { error: error.message });
      console.error(error);
      sendJson(res, 500, { error: 'internal server error' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  createAppServer().listen(port, host, () => {
    console.log(`Parnuan transaction review POC listening on http://${host}:${port}`);
  });
}
