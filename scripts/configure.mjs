// Gera config.js e ajusta a CSP do vercel.json para o seu projeto Supabase.
// Uso: SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node scripts/configure.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_ANON_KEY || '';
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  console.error('SUPABASE_URL inválida (esperado https://<ref>.supabase.co)');
  process.exit(1);
}
if (!key || /service_role/.test(Buffer.from(key.split('.')[1] || '', 'base64').toString())) {
  console.error('SUPABASE_ANON_KEY ausente ou é uma service_role key (NUNCA use a service_role no app!)');
  process.exit(1);
}

let cfg = readFileSync('config.js', 'utf8');
cfg = cfg.replace(/supabaseUrl: '[^']*'/, `supabaseUrl: '${url}'`)
         .replace(/supabaseAnonKey: '[^']*'/, `supabaseAnonKey: '${key}'`);
writeFileSync('config.js', cfg);

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
for (const block of vercel.headers) {
  for (const h of block.headers) {
    if (h.key === 'Content-Security-Policy') {
      h.value = h.value.replace(/connect-src [^;]*/, `connect-src 'self' ${url}`);
    }
  }
}
writeFileSync('vercel.json', JSON.stringify(vercel, null, 2) + '\n');
console.log('config.js e vercel.json atualizados para', url);
