#!/usr/bin/env node
// NotaMais: gera o kit de um cliente que aceitou o teste.
//   - link oficial de avaliação do Google (abre direto a tela de avaliar)
//   - display de balcão com QR code (PNG e PDF A6 para imprimir)
//   - mensagens prontas para o dono mandar aos clientes dele
//
// Uso:
//   GOOGLE_MAPS_API_KEY=xxx node kit-cliente.mjs --busca "Barbearia do Zé Campinas"
//   node kit-cliente.mjs --place-id ChIJ... --nome "Barbearia do Zé"   (sem chave da API)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import QRCode from 'qrcode';
import { searchText } from './buscar-leads.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const DIR = dirname(fileURLToPath(import.meta.url));
const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? acc.concat([[v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]]) : acc), []));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'cliente';

let placeId = typeof a['place-id'] === 'string' ? a['place-id'] : null;
let nome = typeof a.nome === 'string' ? a.nome : null;
let info = {};

if (!placeId) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || typeof a.busca !== 'string') {
    console.error('Use --busca "Nome do negócio Cidade" (com GOOGLE_MAPS_API_KEY) ou --place-id ID --nome "Nome".');
    process.exit(1);
  }
  const r = await searchText(key, a.busca);
  const p = (r.places || [])[0];
  if (!p) { console.error('Nenhum negócio encontrado para essa busca.'); process.exit(1); }
  placeId = p.id; nome = nome || p.displayName?.text;
  info = { endereco: p.formattedAddress, nota: p.rating, avaliacoes: p.userRatingCount };
  console.log(`Encontrado: ${nome} · ${info.endereco} · ★ ${info.nota ?? '-'} (${info.avaliacoes ?? 0})`);
  if ((r.places || []).length > 1) console.log('  (confira se é o negócio certo; se não for, refine a --busca)');
}
if (!/^[A-Za-z0-9_-]{10,}$/.test(placeId)) { console.error('place-id inválido'); process.exit(1); }
nome = nome || 'Seu Negócio';

// Link oficial do Google que abre direto a janela de avaliação
const link = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
const out = join(process.cwd(), 'clientes', slug(nome));
mkdirSync(out, { recursive: true });

const qrSvg = await QRCode.toString(link, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
await QRCode.toFile(join(out, 'qrcode.png'), link, { width: 1000, margin: 2 });
const html = readFileSync(join(DIR, 'imagens', 'display-balcao.html'), 'utf8')
  .replace('__QR__', qrSvg).replace('__NEGOCIO__', esc(nome)).replace('<div class="tag">__TAG__</div>', '');
writeFileSync(join(out, 'display.html'), html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
await page.goto(pathToFileURL(join(out, 'display.html')).href);
await page.screenshot({ path: join(out, 'display-balcao.png') });
// PDF A6 (10,5 x 14,8 cm) só com o cartão, pronto para imprimir em gráfica rápida
await page.addStyleTag({ content: 'body{background:#fff!important;width:auto;height:auto;display:block} .card{box-shadow:none;width:100%;border-radius:0;padding:28px 22px} h1{font-size:30px} .biz{font-size:16px} .stars{font-size:38px;margin:4px 0 12px} .qr{width:210px;height:210px;padding:10px;border-width:3px;border-radius:16px} .how{font-size:15px;margin-top:12px} .g{font-size:12px;margin-top:10px}' });
await page.pdf({ path: join(out, 'display-A6.pdf'), width: '105mm', height: '148mm', printBackground: true, pageRanges: '1' });
await browser.close();

const msgs = `LINK DE AVALIAÇÃO DO GOOGLE (${nome})
${link}

━━ Mensagem para mandar ao cliente depois do atendimento (copie e cole) ━━
Oi, [nome do cliente]! Aqui é da ${nome} 😊 Obrigado pela visita!
Se puder, deixa sua avaliação pra gente no Google? Leva 30 segundos e ajuda muito o nosso trabalho ⭐
${link}

━━ Versão curta (para status do WhatsApp / Instagram) ━━
Gostou do nosso atendimento? Avalie a ${nome} no Google ⭐ Leva 30 segundos!
${link}

━━ Dicas para o dono (mande junto) ━━
• Peça para TODOS os clientes, não só para quem gostou (é a regra do Google).
• Nunca ofereça desconto ou brinde em troca de avaliação: é proibido e o Google pode remover as avaliações.
• Responda as avaliações (as boas e as ruins) com educação: isso também ajuda no ranking.
• O melhor momento para pedir é logo depois do atendimento, enquanto o cliente ainda está satisfeito.
`;
writeFileSync(join(out, 'mensagens.txt'), msgs);
writeFileSync(join(out, 'cliente.json'), JSON.stringify({ nome, placeId, link, criadoEm: new Date().toISOString(), inicio: info }, null, 2));

console.log(`✔ Kit pronto em ${out}`);
console.log('  display-balcao.png (WhatsApp) · display-A6.pdf (imprimir) · qrcode.png · mensagens.txt');
