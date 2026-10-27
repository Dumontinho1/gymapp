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

// ---------------------------------------------------------------- pontuação
/* Celular brasileiro (DDD + 9 dígitos começando com 9): quase sempre tem
   WhatsApp. Fixo pode ter WhatsApp Business, mas é menos provável. */
export function telefoneBR(nacional, internacional) {
  const digits = String(internacional || nacional || '').replace(/\D/g, '');
  let n = digits.startsWith('55') ? digits.slice(2) : digits;
  n = n.replace(/^0/, '');
  if (n.length < 10 || n.length > 11) return null;
  const ddd = n.slice(0, 2), resto = n.slice(2);
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

export function mensagens(l, ref, nome) {
  const quem = nome ? `Aqui é ${nome}` : 'Tudo bem';
  const n = l.userRatingCount || 0;
  let gancho;
  if (n === 0) {
    gancho = `vi que a ${l.nome} ainda não tem avaliações no Google`;
  } else if (ref && ref.userRatingCount >= Math.max(3 * n, 30)) {
    gancho = `vi a ${l.nome} no Google Maps: nota ${fmtNota(l.rating)} com ${n} avaliações. Tem ${l.categoria === 'academia' ? 'academia' : l.categoria} aqui na região passando de ${ref.userRatingCount} avaliações, e quem tem mais aparece primeiro quando alguém procura "${l.categoria} perto de mim"`;
  } else {
    gancho = `vi a ${l.nome} no Google Maps: nota ${fmtNota(l.rating)} com ${n} avaliações`;
  }
  const primeira =
`Olá! ${quem}, ${gancho}.

Estou ajudando negócios aqui da região a receber mais avaliações 5★ no Google, de forma automática e dentro das regras do Google. O cliente recebe um lembrete simples depois do atendimento e avalia em 30 segundos.

Estou com vagas para um teste grátis de 30 dias, sem compromisso. Posso te mandar uma imagem de como funciona?`;

  const followup =
`Oi! Passando só pra saber se você viu minha mensagem sobre as avaliações da ${l.nome} no Google 🙂 Se não fizer sentido agora, sem problema, é só me avisar que eu não mando mais.`;

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

export function processar(lugares, nome) {
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
      telefoneTexto: p.nationalPhoneNumber || '',
      telefone: telefoneBR(p.nationalPhoneNumber, p.internationalPhoneNumber),
      maps: p.googleMapsUri || '',
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
      const { score, motivos } = pontuar(l, ref);
      const msg = mensagens(l, ref[l.categoria], nome);
      return {
        ...l, score, motivos,
        whatsapp: waLink(l.telefone.e164, msg.primeira),
        whatsappFollowup: waLink(l.telefone.e164, msg.followup),
        mensagem: msg.primeira,
      };
    })
    .sort((a, b) => b.score - a.score || a.userRatingCount - b.userRatingCount);
}

function salvar(leads, dir, meta) {
  mkdirSync(dir, { recursive: true });
  const cols = ['score', 'nome', 'categoria', 'rating', 'userRatingCount', 'telefoneTexto', 'endereco', 'motivos', 'maps', 'whatsapp'];
  const head = ['pontuação', 'nome', 'categoria', 'nota', 'avaliações', 'telefone', 'endereço', 'por que', 'google maps', 'link whatsapp'];
  const csv = [head.map(csvCell).join(';')]
    .concat(leads.map((l) => cols.map((c) => csvCell(c === 'motivos' ? l.motivos.join(', ') : c === 'rating' ? fmtNota(l.rating) : l[c])).join(';')))
    .join('\r\n');
  writeFileSync(join(dir, 'leads.csv'), '﻿' + csv); // BOM: acentos certos no Excel

  const template = readFileSync(join(HERE, 'painel-template.html'), 'utf8');
  // JSON dentro de <script type="application/json">: "<" escapado impede fechar a tag (XSS)
  const data = JSON.stringify({ meta, leads }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
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

  if (a.demo) {
    lugares = demo(); cidade = 'Demonstração';
  } else {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) { console.error('Defina GOOGLE_MAPS_API_KEY (veja o PLANO.md, seção "Robô de prospecção").'); process.exit(1); }
    if (typeof cidade !== 'string') { console.error('Informe a cidade: --cidade "Campinas, SP"'); process.exit(1); }
    const categorias = typeof a.categorias === 'string' ? a.categorias.split(',').map((s) => s.trim()).filter(Boolean) : CATEGORIAS_PADRAO;
    const paginas = Math.min(3, Math.max(1, parseInt(a.paginas, 10) || 3));
    console.log(`Buscando ${categorias.length} categorias em ${cidade} (até ${paginas * 20} por categoria)…`);
    ({ lugares, chamadas } = await buscar(key, cidade, categorias, paginas));
  }

  const leads = processar(lugares, nome);
  salvar(leads, saida, { cidade, geradoEm: new Date().toISOString(), nome });
  const quentes = leads.filter((l) => l.score >= 70).length;
  console.log(`✔ ${lugares.length} negócios analisados, ${leads.length} com telefone, ${quentes} com pontuação alta (≥70).`);
  if (chamadas) console.log(`  Buscas usadas: ${chamadas} (cota grátis do Google: ~1.000/mês).`);
  console.log(`  Abra o painel: ${join(saida, 'leads.html')}`);
  console.log(`  Planilha:      ${join(saida, 'leads.csv')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
}
