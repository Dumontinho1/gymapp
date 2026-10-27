// Servidor estático local que imita a Vercel: aplica os cabeçalhos do
// vercel.json e não serve o que está no .vercelignore. Para testar com o
// Supabase local: LOCAL_SUPABASE=1 node scripts/serve.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 5173);
const LOCAL = process.env.LOCAL_SUPABASE === '1';
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const ignored = readFileSync(join(ROOT, '.vercelignore'), 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

function isIgnored(rel) {
  return ignored.some((pat) => {
    if (pat.endsWith('/')) return rel.startsWith(pat);
    if (pat.endsWith('*')) return rel.startsWith(pat.slice(0, -1));
    return rel === pat;
  }) || rel.split('/').some((seg) => seg.startsWith('.'));
}

function headersFor(pathname) {
  const out = {};
  for (const block of vercel.headers) {
    const re = new RegExp('^' + block.source + '$');
    if (re.test(pathname)) for (const h of block.headers) out[h.key] = h.value;
  }
  if (LOCAL && out['Content-Security-Policy']) {
    out['Content-Security-Policy'] = out['Content-Security-Policy']
      .replace(/connect-src [^;]*/, `connect-src 'self' ${LOCAL_URL}`)
      .replace(/; upgrade-insecure-requests/, '');
  }
  delete out['Strict-Transport-Security']; // HSTS em http://localhost não faz sentido
  return out;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const rel = normalize(pathname).replace(/^[/\\]+/, '');
  const file = join(ROOT, rel);
  const hdrs = headersFor(url.pathname);

  if (!file.startsWith(ROOT + sep) || isIgnored(rel.split(sep).join('/')) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { ...hdrs, 'Content-Type': 'text/plain' });
    return res.end('404');
  }
  let body = readFileSync(file);
  if (LOCAL && rel === 'config.js') {
    body = Buffer.from(body.toString()
      .replace(/supabaseUrl: '[^']*'/, `supabaseUrl: '${LOCAL_URL}'`)
      .replace(/supabaseAnonKey: '[^']*'/, `supabaseAnonKey: '${LOCAL_ANON}'`));
  }
  res.writeHead(200, { ...hdrs, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`GymApp em http://127.0.0.1:${PORT}${LOCAL ? ' (Supabase local)' : ''}`));
