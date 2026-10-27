// Testes das Edge Functions (checkout, trial único, webhook, portal, exclusão).
// Pré-requisito: `npx supabase start` e
//   `npx supabase functions serve --env-file supabase/functions/.env.test`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { startFakeStripe } from './fake-stripe.mjs';

const URL = 'http://127.0.0.1:54321';
const FN = URL + '/functions/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const WHSEC = 'whsec_test_local_secret';
const ORIGIN = 'http://127.0.0.1:5173';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const stripeLib = new Stripe('sk_test_x');
const run = Date.now().toString(36);
let fake;
const created = [];

async function makeUser(email, confirmed = true) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Senha-Forte-123', email_confirm: confirmed });
  if (error) throw error;
  created.push(data.user.id);
  if (!confirmed) return { id: data.user.id, token: null };
  const c = createClient(URL, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password: 'Senha-Forte-123' });
  if (s.error) throw s.error;
  return { id: data.user.id, token: s.data.session.access_token, c };
}
function call(name, token, body, extra = {}) {
  return fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Origin: ORIGIN, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra },
    body: body === undefined ? '{}' : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}
function webhook(event, secret = WHSEC) {
  const payload = JSON.stringify(event);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${FN}/stripe-webhook`, { method: 'POST', headers: { 'Stripe-Signature': header, 'Content-Type': 'application/json' }, body: payload });
}
const evt = (type, object) => ({ id: 'evt_' + Math.random().toString(36).slice(2), object: 'event', type, data: { object } });
const profile = async (id) => (await admin.from('profiles').select('*').eq('id', id).single()).data;

before(async () => { fake = await startFakeStripe(12111); });
after(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
  fake.close();
});

test('checkout sem login -> 401', async () => {
  const r = await call('create-checkout', null, { interval: 'month' });
  assert.equal(r.status, 401);
});

test('login sem confirmar o e-mail é bloqueado', async () => {
  const u = await makeUser(`nc-${run}@teste.dev`, false);
  const c = createClient(URL, ANON, opts);
  const s = await c.auth.signInWithPassword({ email: `nc-${run}@teste.dev`, password: 'Senha-Forte-123' });
  assert.ok(s.error, 'login sem confirmar e-mail deveria falhar');
  assert.ok(u.id);
});

test('intervalo inválido e JSON inválido -> 400', async () => {
  const u = await makeUser(`inv-${run}@teste.dev`);
  assert.equal((await call('create-checkout', u.token, { interval: 'day' })).status, 400);
  assert.equal((await call('create-checkout', u.token, '{nope')).status, 400);
  assert.equal((await call('create-checkout', u.token, '[1]')).status, 400);
});

test('origem não autorizada -> 403 e sem CORS', async () => {
  const u = await makeUser(`orig-${run}@teste.dev`);
  const r = await call('create-checkout', u.token, { interval: 'month' }, { Origin: 'https://site-malicioso.com' });
  assert.equal(r.status, 403);
  // O gateway Kong LOCAL injeta "*"; no Supabase hospedado vale o header da função.
  // O que importa: a origem maliciosa nunca é refletida (e o request é recusado).
  assert.notEqual(r.headers.get('access-control-allow-origin'), 'https://site-malicioso.com');
});

test('CORS preflight só libera a origem do app', async () => {
  const ok = await fetch(`${FN}/create-checkout`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
  assert.ok([ORIGIN, '*'].includes(ok.headers.get('access-control-allow-origin'))); // '*' = Kong local
  const bad = await fetch(`${FN}/create-checkout`, { method: 'OPTIONS', headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' } });
  assert.notEqual(bad.headers.get('access-control-allow-origin'), 'https://evil.com');
});

test('body grande demais -> 413', async () => {
  const u = await makeUser(`big-${run}@teste.dev`);
  const r = await call('create-checkout', u.token, JSON.stringify({ interval: 'month', pad: 'x'.repeat(20000) }));
  assert.equal(r.status, 413);
});

let T; // usuário do fluxo completo de trial
test('1º checkout: cria cliente Stripe e oferece 7 dias grátis', async () => {
  T = await makeUser(`trial-${run}@teste.dev`);
  const r = await call('create-checkout', T.token, { interval: 'year' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(j.trial, true);
  const cs = fake.state.checkouts.at(-1).params;
  assert.equal(cs['subscription_data[trial_period_days]'], '7');
  assert.equal(cs['line_items[0][price]'], 'price_year');
  assert.equal(cs.success_url, ORIGIN + '/?checkout=success');
  assert.equal(cs.client_reference_id, T.id);
  const p = await profile(T.id);
  assert.match(p.stripe_customer_id, /^cus_/);
});

test('webhook com assinatura inválida é rejeitado e não altera nada', async () => {
  const p = await profile(T.id);
  const r = await webhook(evt('customer.subscription.created', { customer: p.stripe_customer_id }), 'whsec_errado');
  assert.equal(r.status, 400);
  const r2 = await fetch(`${FN}/stripe-webhook`, { method: 'POST', body: '{}' });
  assert.equal(r2.status, 400);
  assert.equal((await profile(T.id)).subscription_status, 'none');
});

test('webhook válido ativa o trial e marca trial_used', async () => {
  const p = await profile(T.id);
  const sub = fake.state.addSub({ customer: p.stripe_customer_id, status: 'trialing', trial: true, interval: 'year', days: 7 });
  const r = await webhook(evt('checkout.session.completed', { customer: p.stripe_customer_id, client_reference_id: T.id }));
  assert.equal(r.status, 200);
  const after = await profile(T.id);
  assert.equal(after.subscription_status, 'trialing');
  assert.equal(after.subscription_id, sub.id);
  assert.equal(after.plan_interval, 'year');
  assert.equal(after.trial_used, true);
});

test('webhook ignora conteúdo forjado do evento e relê o Stripe', async () => {
  const p = await profile(T.id);
  // evento diz "active", mas a fonte da verdade (Stripe) diz trialing
  const r = await webhook(evt('customer.subscription.updated', { customer: p.stripe_customer_id, status: 'active' }));
  assert.equal(r.status, 200);
  assert.equal((await profile(T.id)).subscription_status, 'trialing');
});

test('evento duplicado é idempotente', async () => {
  const p = await profile(T.id);
  const e = evt('customer.subscription.updated', { customer: p.stripe_customer_id });
  assert.equal((await webhook(e)).status, 200);
  const r = await webhook(e);
  assert.equal(await r.text(), 'duplicate');
});

test('já Premium não abre outro checkout (409)', async () => {
  const r = await call('create-checkout', T.token, { interval: 'month' });
  assert.equal(r.status, 409);
});

test('assinatura dupla (duas abas) -> a mais nova é cancelada', async () => {
  const p = await profile(T.id);
  const dup = fake.state.addSub({ customer: p.stripe_customer_id, status: 'active' });
  await webhook(evt('customer.subscription.created', { customer: p.stripe_customer_id }));
  assert.ok(fake.state.canceled.includes(dup.id));
  assert.equal((await profile(T.id)).subscription_status, 'trialing');
});

test('cancelou o trial -> volta Free e NÃO ganha outro trial', async () => {
  const p = await profile(T.id);
  fake.state.subs.filter((s) => s.customer === p.stripe_customer_id).forEach((s) => { s.status = 'canceled'; });
  await webhook(evt('customer.subscription.deleted', { customer: p.stripe_customer_id }));
  const after = await profile(T.id);
  assert.equal(after.subscription_status, 'canceled');
  const r = await call('create-checkout', T.token, { interval: 'month' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.trial, false);
  assert.equal(fake.state.checkouts.at(-1).params['subscription_data[trial_period_days]'], undefined);
});

test('portal do cliente: só para quem tem cliente Stripe, URL do Stripe', async () => {
  const n = await makeUser(`portal-${run}@teste.dev`);
  assert.equal((await call('customer-portal', n.token)).status, 404);
  const r = await call('customer-portal', T.token);
  assert.equal(r.status, 200);
  assert.match((await r.json()).url, /^https:\/\/billing\.stripe\.com\//);
});

test('excluir conta exige confirmação, cancela assinatura e apaga tudo', async () => {
  const D = await makeUser(`del-${run}@teste.dev`);
  await call('create-checkout', D.token, { interval: 'month' });
  const p = await profile(D.id);
  const sub = fake.state.addSub({ customer: p.stripe_customer_id, status: 'active' });
  await webhook(evt('customer.subscription.created', { customer: p.stripe_customer_id }));
  assert.equal((await call('delete-account', D.token, {})).status, 400);
  const r = await call('delete-account', D.token, { confirm: 'EXCLUIR' });
  assert.equal(r.status, 200);
  assert.ok(fake.state.canceled.includes(sub.id));
  const gone = await admin.from('profiles').select('id').eq('id', D.id);
  assert.equal(gone.data.length, 0);
  // token antigo não serve mais
  assert.equal((await call('create-checkout', D.token, { interval: 'month' })).status, 401);
});

test('trial não volta após excluir conta e recadastrar o mesmo e-mail', async () => {
  const email = `volta-${run}@teste.dev`;
  const V = await makeUser(email);
  await call('create-checkout', V.token, { interval: 'month' });
  const p = await profile(V.id);
  fake.state.addSub({ customer: p.stripe_customer_id, status: 'trialing', trial: true });
  await webhook(evt('customer.subscription.created', { customer: p.stripe_customer_id }));
  assert.equal((await call('delete-account', V.token, { confirm: 'EXCLUIR' })).status, 200);
  const V2 = await makeUser(email);
  const r = await call('create-checkout', V2.token, { interval: 'month' });
  assert.equal((await r.json()).trial, false);
});

test('GET e métodos não-POST são recusados', async () => {
  const r = await fetch(`${FN}/create-checkout`, { headers: { apikey: ANON, Origin: ORIGIN } });
  assert.ok(r.status === 405 || r.status === 401);
});
