// Testes de segurança do banco (RLS, privilégios, RPCs) contra o Supabase local.
// Pré-requisito: `npx supabase start`. Rodar: node --test tests/rls.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// Chaves de demonstração PÚBLICAS do Supabase local (iguais em toda instalação).
const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const anon = createClient(URL, ANON, opts);
const PW = 'Senha-Forte-123';
const run = Date.now().toString(36);
const created = [];

async function makeUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  const c = createClient(URL, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password: PW });
  if (s.error) throw s.error;
  return { id: data.user.id, c };
}
async function setPremium(id, status = 'active', days = 30) {
  const end = new Date(Date.now() + days * 86400000).toISOString();
  const { error } = await admin.from('profiles').update({ subscription_status: status, current_period_end: end }).eq('id', id);
  if (error) throw error;
}

let A, B;
before(async () => {
  A = await makeUser(`a-${run}@teste.dev`);
  B = await makeUser(`b-${run}@teste.dev`);
});
after(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
});

test('cadastro cria profile no plano Free', async () => {
  const { data, error } = await A.c.from('profiles').select('*').eq('id', A.id).single();
  assert.equal(error, null);
  assert.equal(data.subscription_status, 'none');
  assert.equal(data.trial_used, false);
});

test('usuário NÃO lê o profile de outro', async () => {
  const { data } = await A.c.from('profiles').select('*').eq('id', B.id);
  assert.deepEqual(data, []);
  const all = await A.c.from('profiles').select('id');
  assert.deepEqual(all.data.map((r) => r.id), [A.id]);
});

test('usuário NÃO consegue se dar Premium (update no profile)', async () => {
  const r = await A.c.from('profiles').update({ subscription_status: 'active', current_period_end: '2099-01-01' }).eq('id', A.id).select();
  assert.ok(r.error, 'update deveria falhar');
  const { data } = await admin.from('profiles').select('subscription_status').eq('id', A.id).single();
  assert.equal(data.subscription_status, 'none');
});

test('usuário NÃO consegue inserir/apagar profiles', async () => {
  const ins = await A.c.from('profiles').insert({ id: crypto.randomUUID(), subscription_status: 'active' });
  assert.ok(ins.error);
  const del = await A.c.from('profiles').delete().eq('id', A.id).select();
  assert.ok(del.error || del.data.length === 0);
  const { data } = await admin.from('profiles').select('id').eq('id', A.id);
  assert.equal(data.length, 1);
});

test('anônimo não lê nada', async () => {
  for (const t of ['profiles', 'user_data', 'trial_ledger', 'stripe_events']) {
    const r = await anon.from(t).select('*');
    assert.ok(r.error || r.data.length === 0, `anon leu ${t}`);
  }
  const rpc = await anon.rpc('push_user_data', { p_data: { a: 1 }, p_base_rev: 0 });
  assert.ok(rpc.error);
});

test('escrita direta em user_data é bloqueada (mesmo Premium)', async () => {
  await setPremium(A.id);
  const ins = await A.c.from('user_data').insert({ user_id: A.id, data: { x: 1 } });
  assert.ok(ins.error, 'insert direto deveria falhar');
  await setPremium(A.id, 'none');
});

test('push_user_data exige Premium', async () => {
  const r = await A.c.rpc('push_user_data', { p_data: { workouts: {} }, p_base_rev: 0 });
  assert.ok(r.error);
  assert.match(r.error.message, /premium_required/);
});

test('Premium expirado (fora da tolerância) não sincroniza', async () => {
  await setPremium(A.id, 'active', -3);
  const r = await A.c.rpc('push_user_data', { p_data: { workouts: {} }, p_base_rev: 0 });
  assert.match(r.error?.message ?? '', /premium_required/);
  await setPremium(A.id, 'none');
});

test('Premium sincroniza, com controle de concorrência (rev)', async () => {
  await setPremium(A.id, 'trialing');
  const r1 = await A.c.rpc('push_user_data', { p_data: { v: 1 }, p_base_rev: 0 });
  assert.equal(r1.error, null);
  assert.equal(r1.data, 1);
  const r2 = await A.c.rpc('push_user_data', { p_data: { v: 2 }, p_base_rev: 1 });
  assert.equal(r2.data, 2);
  // outro aparelho com rev velho -> conflito, não sobrescreve
  const stale = await A.c.rpc('push_user_data', { p_data: { v: 'velho' }, p_base_rev: 1 });
  assert.match(stale.error?.message ?? '', /conflict/);
  const { data } = await A.c.from('user_data').select('data, rev').single();
  assert.deepEqual(data, { data: { v: 2 }, rev: 2 });
});

test('usuário não lê nem sobrescreve dados de outro', async () => {
  await setPremium(B.id);
  const r = await B.c.from('user_data').select('*').eq('user_id', A.id);
  assert.deepEqual(r.data, []);
  // push sempre grava no próprio auth.uid(), nunca no de outro
  await B.c.rpc('push_user_data', { p_data: { dono: 'B' }, p_base_rev: 0 });
  const a = await admin.from('user_data').select('data').eq('user_id', A.id).single();
  assert.deepEqual(a.data.data, { v: 2 });
});

test('rejeita payload inválido e grande demais', async () => {
  const arr = await A.c.rpc('push_user_data', { p_data: [1, 2], p_base_rev: 2 });
  assert.ok(arr.error);
  const big = { blob: 'x'.repeat(2_100_000) };
  const r = await A.c.rpc('push_user_data', { p_data: big, p_base_rev: 2 });
  assert.ok(r.error);
});

test('funções internas não são chamáveis pelo usuário', async () => {
  for (const [fn, args] of [['mark_trial_used', { p_user: A.id }], ['email_hash', { p_email: 'x@y.z' }], ['handle_new_user', {}], ['is_premium', { p_user: B.id }]]) {
    const r = await A.c.rpc(fn, args);
    assert.ok(r.error, `${fn} deveria ser bloqueada`);
  }
  const { data } = await admin.from('profiles').select('trial_used').eq('id', A.id).single();
  assert.equal(data.trial_used, false);
});

test('trial só uma vez: sobrevive a excluir a conta e recadastrar com variação do e-mail', async () => {
  const email = `fulano.silva+${run}@gmail.com`;
  const u = await makeUser(email);
  const m = await admin.rpc('mark_trial_used', { p_user: u.id });
  assert.equal(m.error, null);
  await admin.auth.admin.deleteUser(u.id);
  // mesmo e-mail com pontos/maiúsculas diferentes e outro "+tag"
  const again = await makeUser(`FulanoSilva+outra@googlemail.com`);
  const { data } = await again.c.from('profiles').select('trial_used').single();
  assert.equal(data.trial_used, true);
});

test('excluir usuário apaga profile e dados (cascade)', async () => {
  const u = await makeUser(`del-${run}@teste.dev`);
  await setPremium(u.id);
  await u.c.rpc('push_user_data', { p_data: { a: 1 }, p_base_rev: 0 });
  await admin.auth.admin.deleteUser(u.id);
  const p = await admin.from('profiles').select('id').eq('id', u.id);
  const d = await admin.from('user_data').select('user_id').eq('user_id', u.id);
  assert.equal(p.data.length, 0);
  assert.equal(d.data.length, 0);
});
