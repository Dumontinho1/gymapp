#!/usr/bin/env node
// NotaMais: resumo semanal de cada cliente (pasta clientes/*/cliente.json).
// Busca a nota e o total de avaliações atuais no Google, guarda o histórico e
// gera a mensagem pronta para mandar ao dono.
// Uso: GOOGLE_MAPS_API_KEY=xxx node relatorio.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) { console.error('Defina GOOGLE_MAPS_API_KEY'); process.exit(1); }
const base = join(process.cwd(), 'clientes');
if (!existsSync(base)) { console.error('Nenhuma pasta clientes/ (gere um kit com kit-cliente.mjs primeiro).'); process.exit(1); }

const fmt = (n) => (n == null ? '-' : Number(n).toFixed(1).replace('.', ','));
for (const dir of readdirSync(base)) {
  const f = join(base, dir, 'cliente.json');
  if (!existsSync(f)) continue;
  const c = JSON.parse(readFileSync(f, 'utf8'));
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(c.placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName,rating,userRatingCount' },
  });
  if (!res.ok) { console.error(`✖ ${c.nome}: Google respondeu ${res.status}`); continue; }
  const p = await res.json();
  const hoje = { data: new Date().toISOString().slice(0, 10), nota: p.rating ?? null, avaliacoes: p.userRatingCount ?? 0 };
  c.historico = (c.historico || []).filter((h) => h.data !== hoje.data).concat(hoje);
  const inicio = c.historico[0];
  const semana = c.historico.length > 1 ? c.historico[c.historico.length - 2] : inicio;
  writeFileSync(f, JSON.stringify(c, null, 2));
  const novasSemana = hoje.avaliacoes - semana.avaliacoes;
  const novasTotal = hoje.avaliacoes - inicio.avaliacoes;
  const msg = `Oi! Resumo semanal da ${c.nome} no Google 📊
⭐ Nota atual: ${fmt(hoje.nota)} (era ${fmt(inicio.nota)} no início)
📝 Avaliações: ${hoje.avaliacoes} → +${novasSemana} esta semana, +${novasTotal} desde o início
${novasSemana > 0 ? 'Ótimo ritmo! Continue pedindo a todos os clientes 💪' : 'Semana mais fraca. Que tal mandar a mensagem para os clientes dos últimos dias? 😉'}`;
  writeFileSync(join(base, dir, `resumo-${hoje.data}.txt`), msg);
  console.log(`\n━━ ${c.nome} ━━\n${msg}`);
}
