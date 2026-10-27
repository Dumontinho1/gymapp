// Gera os PNGs (1080x1350, bom para WhatsApp e Instagram) a partir dos HTMLs.
// Uso: node notamais/imagens/gerar-imagens.mjs [url-do-qr]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import QRCode from 'qrcode';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const DIR = dirname(fileURLToPath(import.meta.url));
const qrUrl = process.argv[2] || 'https://g.page/r/EXEMPLO-DO-SEU-NEGOCIO/review';
const qrSvg = await QRCode.toString(qrUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

const tmp = mkdtempSync(join(tmpdir(), 'notamais-'));
const balcao = join(tmp, 'display-balcao.html');
writeFileSync(balcao, readFileSync(join(DIR, 'display-balcao.html'), 'utf8').replace('__QR__', qrSvg).replace('__NEGOCIO__', '[ Seu Negócio ]').replace('__TAG__', 'Exemplo do display de balcão que o seu negócio recebe ✨'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
for (const [src, out] of [[join(DIR, 'como-funciona.html'), 'como-funciona.png'], [balcao, 'display-balcao.png']]) {
  await page.goto(pathToFileURL(src).href);
  await page.screenshot({ path: join(DIR, out) });
  console.log('✔', join(DIR, out));
}
await browser.close();
