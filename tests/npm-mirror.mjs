// Espelho HTTP mínimo do registry do npm, usado SÓ em ambientes de teste
// cujo proxy HTTPS não é confiável de dentro dos containers do Supabase.
// Uso: NODE_USE_ENV_PROXY=1 node tests/npm-mirror.mjs  (e NPM_CONFIG_REGISTRY=http://<host>:4873/ nas funções)
import http from 'node:http';

const PORT = Number(process.env.MIRROR_PORT || 4873);
const UPSTREAM = 'https://registry.npmjs.org';

http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    const up = await fetch(UPSTREAM + req.url, { headers: { accept: req.headers.accept || '*/*' } });
    const type = up.headers.get('content-type') || '';
    res.statusCode = up.status;
    res.setHeader('content-type', type);
    if (type.includes('json')) {
      const text = (await up.text()).replaceAll(UPSTREAM, 'http://' + host);
      res.end(text);
    } else {
      res.end(Buffer.from(await up.arrayBuffer()));
    }
  } catch (e) {
    res.statusCode = 502;
    res.end(String(e));
  }
}).listen(PORT, '0.0.0.0', () => console.log('npm mirror on', PORT));
