#!/usr/bin/env node
// NotaMais — robô de prospecção.
// Busca negócios locais no Google Maps (Places API oficial), dá uma nota de
// "oportunidade" para cada um e gera:
//   leads.csv   -> planilha (abre no Excel/Google Sheets)
//   leads.html  -> painel no navegador: botão que abre o WhatsApp com a
//                  mensagem personalizada, status de cada contato e follow-ups.
//
// Uso:
//   GOOGLE_MAPS_API_KEY=xxx node buscar-leads.mjs --cidade "Campinas, SP" --nome "Ana"
//   (opcional) --categorias "barbearia,pet shop" --paginas 3 --saida ./leads
//   Demonstração sem chave: node buscar-leads.mjs --demo --nome "Ana"
//
// Sem dependências: só Node 18+.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const CATEGORIAS_PADRAO = [
  'salão de beleza', 'barbearia', 'clínica odontológica', 'clínica de estética', 'academia',
  'studio de pilates', 'pet shop', 'oficina mecânica', 'restaurante', 'hamburgueria',
  'pizzaria', 'clínica de fisioterapia', 'escola de idiomas', 'autoescola', 'lava rápido',
];

// ---------------------------------------------------------------- argumentos
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// ---------------------------------------------------------------- Google Places
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.businessStatus',
  'places.googleMapsUri', 'places.primaryTypeDisplayName', 'places.websiteUri', 'nextPageToken',
].join(',');

export async function searchText(apiKey, textQuery, pageToken) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ textQuery, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    throw new Error(`Google Places respondeu ${res.status}: ${msg}`);
  }
  return body;
}

async function buscar(apiKey, cidade, categorias, paginas) {
  const porId = new Map();
  let chamadas = 0;
  for (const cat of categorias) {
    let token;
    for (let p = 0; p < paginas; p++) {
      const r = await searchText(apiKey, `${cat} em ${cidade}`, token);
      chamadas++;
      for (const pl of r.places || []) {
        if (!porId.has(pl.id)) porId.set(pl.id, { ...pl, categoria: cat });
      }
      process.stdout.write(`\r  ${cat}: ${porId.size} negócios encontrados (${chamadas} buscas)        `);
      token = r.nextPageToken;
      if (!token) break;
      await new Promise((ok) => setTimeout(ok, 1200)); // o token demora um pouco para valer
    }
  }
  process.stdout.write('\n');
  return { lugares: [...porId.values()], chamadas };
}

// ---------------------------------------------------------------- OpenStreetMap (sem chave)
const OSM_CATS = [
  ['shop', 'hairdresser', 'salão/barbearia'], ['shop', 'beauty', 'clínica de estética'], ['shop', 'pet', 'pet shop'],
  ['shop', 'car_repair', 'oficina mecânica'], ['amenity', 'dentist', 'clínica odontológica'], ['healthcare', 'dentist', 'clínica odontológica'],
  ['healthcare', 'physiotherapist', 'clínica de fisioterapia'], ['leisure', 'fitness_centre', 'academia'], ['amenity', 'restaurant', 'restaurante'],
  ['amenity', 'fast_food', 'lanchonete'], ['amenity', 'veterinary', 'veterinário'], ['amenity', 'driving_school', 'autoescola'],
  ['amenity', 'car_wash', 'lava rápido'], ['amenity', 'language_school', 'escola de idiomas'],
];

/* Escolhe o melhor telefone de uma lista "a; b; c" (celular primeiro). */
export function melhorTelefone(...campos) {
  const nums = campos.filter(Boolean).flatMap((c) => String(c).split(/[;,/]| ou /)).map((x) => x.trim()).filter(Boolean);
  const parsed = nums.map((x) => ({ x, t: telefoneBR(x) })).filter((p) => p.t);
  return (parsed.find((p) => p.t.celular) || parsed[0] || {}).x || '';
}

export function osmParaLugares(elements) {
  const out = [];
  for (const e of elements || []) {
    const t = e.tags || {};
    if (!t.name) continue;
    const cat = OSM_CATS.find(([k, v]) => t[k] === v);
    const tel = melhorTelefone(t['contact:whatsapp'], t['contact:mobile'], t.mobile, t.phone, t['contact:phone']);
    if (!tel) continue;
    const end = [[t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', '), t['addr:suburb'], t['addr:city']].filter(Boolean).join(' - ');
    out.push({ id: `osm-${e.type}-${e.id}`, displayName: { text: t.name }, categoria: cat ? cat[2] : 'negócio local',
      nationalPhoneNumber: tel, formattedAddress: end, websiteUri: t.website || t['contact:website'] || '' });
  }
  return out;
}

async function buscarOSM(cidade) {
  const nomeCidade = String(cidade).split(',')[0].trim().replace(/"/g, '');
  const sel = OSM_CATS.map(([k, v]) => `nwr["${k}"="${v}"](area.a);`).join('\n  ');
  const q = `[out:json][timeout:120];\narea["name"="${nomeCidade}"]["boundary"="administrative"]["admin_level"="8"]->.a;\n(\n  ${sel}\n);\nout tags center;`;
  // Servidores públicos do OpenStreetMap: se um recusar ou estiver lotado, tenta o próximo.
  const servidores = ['https://overpass-api.de', 'https://overpass.kumi.systems', 'https://overpass.private.coffee', 'https://maps.mail.ru/osm/tools/overpass'];
  const erros = [];
  for (const base of servidores) {
    try {
      const res = await fetch(base + '/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(150000) });
      if (!res.ok) { erros.push(`${new URL(base).host}: HTTP ${res.status}`); continue; }
      const j = await res.json();
      return osmParaLugares(j.elements);
    } catch (e) {
      erros.push(`${new URL(base).host}: ${e.cause?.code || e.message}`);
    }
  }
  throw new Error('Nenhum servidor do OpenStreetMap respondeu (' + erros.join('; ') + ')');
}

// ---------------------------------------------------------------- planilha (Outscraper / Apify / manual)
export function lerCSV(texto) {
  texto = texto.replace(/^\ufeff/, '');
  const prim = texto.split(/\r?\n/)[0] || '';
  const sep = (prim.match(/;/g) || []).length > (prim.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (q) {
      if (ch === '"' && texto[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const col = (o, ...nomes) => { for (const n of nomes) if (o[n] != null && o[n] !== '') return o[n]; return ''; };
const numBR = (v) => { const n = parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(',', '.')); return isFinite(n) ? n : undefined; };

export function csvParaLugares(linhas) {
  return linhas.map((o, i) => {
    const rating = numBR(col(o, 'rating', 'totalscore', 'nota'));
    const count = numBR(col(o, 'reviews', 'reviewscount', 'userratingcount', 'avaliações', 'avaliacoes'));
    const status = col(o, 'business_status', 'businessstatus').toUpperCase();
    return {
      id: col(o, 'place_id', 'placeid', 'google_id') || 'csv-' + i,
      displayName: { text: col(o, 'name', 'title', 'nome') },
      categoria: (col(o, 'category', 'categoryname', 'type', 'subtypes', 'categoria').split(',')[0] || 'negócio local').toLowerCase(),
      nationalPhoneNumber: melhorTelefone(col(o, 'phone', 'phoneunformatted', 'phone_1', 'telefone')),
      formattedAddress: col(o, 'full_address', 'address', 'endereço', 'endereco'),
      // sem nota = sem dados de avaliação (o Google omite a nota quando não há avaliações)
      rating, userRatingCount: rating === undefined ? undefined : (count ?? 0),
      websiteUri: col(o, 'site', 'website', 'site_url', 'websiteuri'),
      googleMapsUri: /^https:\/\/(www\.)?(maps\.)?google\./.test(col(o, 'location_link', 'url')) ? col(o, 'location_link', 'url') : '',
      businessStatus: status === 'OPERATIONAL' || !status ? 'OPERATIONAL' : status,
    };
  }).filter((p) => p.displayName.text && p.nationalPhoneNumber);
}

// ---------------------------------------------------------------- pontuação
/* Celular brasileiro (DDD + 9 dígitos começando com 9): quase sempre tem
   WhatsApp. Fixo pode ter WhatsApp Business, mas é menos provável. */
export function telefoneBR(nacional, internacional) {
  const digits = String(internacional || nacional || '').replace(/\D/g, '');
  if (/^0[3589]00/.test(digits)) return null; // 0800/0300/0500/0900: não tem WhatsApp
  let n = digits.startsWith('55') ? digits.slice(2) : digits;
  n = n.replace(/^0/, '');
  if (n.length < 10 || n.length > 11) return null;
  const ddd = n.slice(0, 2), resto = n.slice(2);
  if (!/^[1-9][1-9]$/.test(ddd)) return null; // DDD brasileiro nunca tem zero
  const celular = resto.length === 9 && resto.startsWith('9');
  return { e164: '55' + n, ddd, celular };
}

export function pontuar(l, refPorCategoria) {
  const motivos = [];
  let s = 0;
  const n = l.userRatingCount || 0;
  const r = l.rating || 0;
  if (l.telefone?.celular) { s += 30; motivos.push('celular (provável WhatsApp)'); }
  else if (l.telefone) { s += 5; motivos.push('telefone fixo'); }

  // Fonte sem nota/avaliações (OpenStreetMap): prioriza pelo celular e pede
  // para conferir o perfil no Maps antes de enviar.
  const semSite = !l.site;
  if (semSite) motivos.push('sem site (oferecer site)');
  if (l.semAvaliacoes) {
    motivos.push('confira as avaliações no Maps antes de enviar');
    return { score: (l.telefone?.celular ? 70 : 35) + (semSite ? 10 : 0), motivos };
  }
  if (semSite) s += 10;

  if (n === 0) { s += 5; motivos.push('nenhuma avaliação'); }
  else if (n <= 20) { s += 30; motivos.push('poucas avaliações'); }
  else if (n <= 80) { s += 25; motivos.push('avaliações abaixo do potencial'); }
  else if (n <= 150) { s += 12; }

  if (n > 0) {
    if (r < 4.0) { s += 20; motivos.push('nota baixa'); }
    else if (r < 4.5) { s += 25; motivos.push('nota pode subir'); }
    else if (r < 4.7) { s += 10; }
  }

  const ref = refPorCategoria[l.categoria];
  if (ref && ref.userRatingCount >= Math.max(3 * n, 30)) { s += 15; motivos.push('concorrência com muito mais avaliações'); }
  return { score: s, motivos };
}

// ---------------------------------------------------------------- mensagens
const fmtNota = (r) => (r ? r.toFixed(1).replace('.', ',') : '–');

export function mensagens(l, ref, nome, cidade) {
  const abertura = nome ? `Olá! Aqui é ${nome}.` : 'Olá, tudo bem?';
  const n = l.userRatingCount || 0;
  const followup =
`Oi! Passando só pra saber se você viu minha mensagem sobre as avaliações da ${l.nome} no Google 🙂 Se não fizer sentido agora, sem problema, é só me avisar que eu não mando mais.`;
  if (l.semAvaliacoes) {
    const onde = cidade ? ` aqui em ${String(cidade).split(',')[0].trim()}` : '';
    const primeira = l.site
? `${abertura} Vi a ${l.nome}${onde} e queria te fazer uma pergunta rápida: vocês costumam pedir para os clientes avaliarem no Google?

Pergunto porque estou ajudando negócios da região a receber mais avaliações 5★ de forma automática e dentro das regras do Google. Quem tem mais avaliações aparece primeiro quando alguém procura "perto de mim".

Estou com vagas para um teste grátis de 30 dias, sem compromisso. Posso te mandar uma imagem de como funciona?`
: `${abertura} Vi a ${l.nome}${onde} e queria te fazer uma pergunta rápida: vocês costumam pedir para os clientes avaliarem no Google?

Pergunto porque ajudo negócios da região a serem mais encontrados na internet:
⭐ mais avaliações 5★ no Google, de forma automática e dentro das regras (quem tem mais aparece primeiro no "perto de mim");
🌐 e, para quem ainda não tem, um site simples e profissional, com WhatsApp, endereço, horários e fotos.

Estou com vagas para um teste grátis de 30 dias das avaliações, sem compromisso. Posso te mandar uma imagem de como funciona?`;
    return { primeira, followup };
  }
  let gancho;
  if (n === 0) {
    gancho = `vi que a ${l.nome} ainda não tem avaliações no Google`;
  } else if (ref && ref.userRatingCount >= Math.max(3 * n, 30)) {
    gancho = `vi a ${l.nome} no Google Maps: nota ${fmtNota(l.rating)} com ${n} avaliações. Tem ${l.categoria === 'academia' ? 'academia' : l.categoria} aqui na região passando de ${ref.userRatingCount} avaliações, e quem tem mais aparece primeiro quando alguém procura "${l.categoria} perto de mim"`;
  } else {
    gancho = `vi a ${l.nome} no Google Maps: nota ${fmtNota(l.rating)} com ${n} avaliações`;
  }
  const site = l.site ? '' : `

Vi também que vocês ainda não têm site. Eu monto um site simples e profissional (WhatsApp, endereço, horários e fotos), se tiver interesse.`;
  const primeira =
`${abertura} ${gancho.charAt(0).toUpperCase() + gancho.slice(1)}.

Estou ajudando negócios aqui da região a receber mais avaliações 5★ no Google, de forma automática e dentro das regras do Google. O cliente recebe um lembrete simples depois do atendimento e avalia em 30 segundos.${site}

Estou com vagas para um teste grátis de 30 dias das avaliações, sem compromisso. Posso te mandar uma imagem de como funciona?`;

  return { primeira, followup };
}

function waLink(e164, texto) {
  return `https://wa.me/${e164}?text=${encodeURIComponent(texto)}`;
}

// ---------------------------------------------------------------- saída
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita "fórmula" maliciosa ao abrir no Excel
  return '"' + s.replace(/"/g, '""') + '"';
}

const mapsBusca = (nome, endereco) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(nome + ' ' + (endereco || ''));

export function processar(lugares, nome, cidade) {
  const ativos = lugares
    .filter((p) => !p.businessStatus || p.businessStatus === 'OPERATIONAL')
    .map((p) => ({
      id: p.id,
      nome: p.displayName?.text || 'Negócio',
      categoria: p.categoria,
      tipo: p.primaryTypeDisplayName?.text || '',
      endereco: p.formattedAddress || '',
      rating: p.rating || 0,
      userRatingCount: p.userRatingCount || 0,
      semAvaliacoes: p.rating == null && p.userRatingCount == null,
      telefone: telefoneBR(p.nationalPhoneNumber, p.internationalPhoneNumber),
      maps: p.googleMapsUri || mapsBusca(p.displayName?.text || '', p.formattedAddress),
      site: p.websiteUri || '',
    }));

  // referência da categoria = o mais avaliado com nota boa
  const ref = {};
  for (const l of ativos) {
    if (l.rating >= 4.6 && (!ref[l.categoria] || l.userRatingCount > ref[l.categoria].userRatingCount)) ref[l.categoria] = l;
  }

  return ativos
    .filter((l) => l.telefone) // sem telefone não há como contatar
    .map((l) => {
      const r = l.telefone.e164.slice(4);
      l.telefoneTexto = `(${l.telefone.ddd}) ${r.slice(0, r.length - 4)}-${r.slice(-4)}`;
      const { score, motivos } = pontuar(l, ref);
      const msg = mensagens(l, ref[l.categoria], nome, cidade);
      return {
        ...l, score, motivos,
        whatsapp: waLink(l.telefone.e164, msg.primeira),
        whatsappFollowup: waLink(l.telefone.e164, msg.followup),
        mensagem: msg.primeira,
      };
    })
    .sort((a, b) => b.score - a.score || a.userRatingCount - b.userRatingCount);
}

function salvar(leads, dir, meta, lugares) {
  mkdirSync(dir, { recursive: true });
  // dados brutos: permitem regerar o painel/mensagens sem buscar de novo (--reusar)
  if (lugares) writeFileSync(join(dir, 'lugares.json'), JSON.stringify({ cidade: meta.cidade, geradoEm: meta.geradoEm, lugares }));
  const cols = ['score', 'nome', 'categoria', 'rating', 'userRatingCount', 'telefoneTexto', 'endereco', 'site', 'motivos', 'maps', 'whatsapp'];
  const head = ['pontuação', 'nome', 'categoria', 'nota', 'avaliações', 'telefone', 'endereço', 'site', 'por que', 'google maps', 'link whatsapp'];
  const csv = [head.map(csvCell).join(';')]
    .concat(leads.map((l) => cols.map((c) => csvCell(c === 'motivos' ? l.motivos.join(', ') : c === 'rating' ? (l.semAvaliacoes ? '' : fmtNota(l.rating)) : c === 'userRatingCount' && l.semAvaliacoes ? '' : l[c])).join(';')))
    .join('\r\n');
  writeFileSync(join(dir, 'leads.csv'), '﻿' + csv); // BOM: acentos certos no Excel

  const template = readFileSync(join(HERE, 'painel-template.html'), 'utf8');
  // JSON dentro de <script type="application/json">: "<" escapado impede fechar a tag (XSS)
  // As imagens vão embutidas no painel para anexar no WhatsApp (o link wa.me só leva texto)
  const imagens = [['como-funciona.png', 'Como funciona'], ['display-balcao.png', 'Display de balcão']]
    .filter(([f]) => existsSync(join(HERE, 'imagens', f)))
    .map(([f, titulo]) => ({ arquivo: f, titulo, dataUrl: 'data:image/png;base64,' + readFileSync(join(HERE, 'imagens', f)).toString('base64') }));
  const data = JSON.stringify({ meta, leads, imagens }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  writeFileSync(join(dir, 'leads.html'), template.replace('/*__DADOS__*/{}', () => data));
}

// ---------------------------------------------------------------- demo
function demo() {
  const mk = (id, nome, categoria, rating, n, tel) => ({
    id, displayName: { text: nome }, categoria, rating, userRatingCount: n, nationalPhoneNumber: tel,
    formattedAddress: 'Rua Exemplo, 123 - Centro, Cidade - SP', businessStatus: 'OPERATIONAL',
    googleMapsUri: 'https://maps.google.com/?cid=' + id,
  });
  return [
    mk('1', 'Barbearia do Zé', 'barbearia', 4.3, 18, '(19) 99876-5432'),
    mk('2', 'Barbearia Premium Club', 'barbearia', 4.9, 412, '(19) 99111-2222'),
    mk('3', 'Studio Bella Unhas', 'salão de beleza', 4.6, 7, '(19) 98888-7777'),
    mk('4', 'Oficina Irmãos Souza', 'oficina mecânica', 3.9, 41, '(19) 3232-4545'),
    mk('5', 'Pet Shop Amigo Fiel', 'pet shop', 4.4, 63, '(19) 99555-1234'),
    mk('6', 'Clínica Sorriso & Cia', 'clínica odontológica', 4.8, 230, '(19) 99777-0000'),
    mk('7', '<img src=x onerror=alert(1)> Lanches', 'hamburgueria', 4.2, 25, '(19) 99444-3333'),
    mk('8', 'Restaurante Sem Telefone', 'restaurante', 4.1, 30, ''),
  ];
}

// ---------------------------------------------------------------- main
async function main() {
  const a = args(process.argv.slice(2));
  const nome = typeof a.nome === 'string' ? a.nome : '';
  const saida = typeof a.saida === 'string' ? a.saida : join(process.cwd(), 'leads');
  let lugares, chamadas = 0, cidade = a.cidade;

  if (a.reusar) {
    const f = join(saida, 'lugares.json');
    if (!existsSync(f)) { console.error(`Não há ${f}. Rode uma busca antes.`); process.exit(1); }
    const c = JSON.parse(readFileSync(f, 'utf8'));
    lugares = c.lugares; cidade = typeof cidade === 'string' ? cidade : c.cidade;
    console.log(`Reusando ${lugares.length} negócios da busca de ${new Date(c.geradoEm).toLocaleDateString('pt-BR')} (${cidade}).`);
  } else if (a.demo) {
    lugares = demo(); cidade = 'Demonstração';
  } else if (typeof a.csv === 'string') {
    lugares = csvParaLugares(lerCSV(readFileSync(a.csv, 'utf8')));
    cidade = typeof cidade === 'string' ? cidade : 'Planilha importada';
    console.log(`Planilha: ${lugares.length} negócios com nome e telefone.`);
  } else if (a.fonte === 'osm') {
    if (typeof cidade !== 'string') { console.error('Informe a cidade: --cidade "Belo Horizonte, MG"'); process.exit(1); }
    console.log(`Buscando no OpenStreetMap: ${cidade}…`);
    lugares = await buscarOSM(cidade);
  } else {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) { console.error('Defina GOOGLE_MAPS_API_KEY (veja o PLANO.md, seção "Robô de prospecção").'); process.exit(1); }
    if (typeof cidade !== 'string') { console.error('Informe a cidade: --cidade "Campinas, SP"'); process.exit(1); }
    const categorias = typeof a.categorias === 'string' ? a.categorias.split(',').map((s) => s.trim()).filter(Boolean) : CATEGORIAS_PADRAO;
    const paginas = Math.min(3, Math.max(1, parseInt(a.paginas, 10) || 3));
    console.log(`Buscando ${categorias.length} categorias em ${cidade} (até ${paginas * 20} por categoria)…`);
    ({ lugares, chamadas } = await buscar(key, cidade, categorias, paginas));
  }

  const leads = processar(lugares, nome, cidade);
  salvar(leads, saida, { cidade, geradoEm: new Date().toISOString(), nome }, lugares);
  const quentes = leads.filter((l) => l.score >= 70).length;
  console.log(`✔ ${lugares.length} negócios analisados, ${leads.length} com telefone, ${quentes} com pontuação alta (≥70).`);
  if (chamadas) console.log(`  Buscas usadas: ${chamadas} (cota grátis do Google: ~1.000/mês).`);
  if (leads.some((l) => l.semAvaliacoes)) console.log('  Fonte sem nota/avaliações: confira o perfil no Google Maps (link no painel) antes de enviar.');
  console.log(`  Abra o painel: ${join(saida, 'leads.html')}`);
  console.log(`  Planilha:      ${join(saida, 'leads.csv')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
}
