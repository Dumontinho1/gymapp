// Testes ponta a ponta com navegador real (Playwright/Chromium).
// - Modo Free sem backend (porta 5174): bloqueios, histórico 7 dias, biblioteca, XSS.
// - Modo com Supabase local (porta 5173): cadastro com confirmação de e-mail,
//   checkout com trial, Premium, sync entre dois "aparelhos", conflito, logout.
// Pré-requisitos do modo nuvem: `npx supabase start` e functions serve (ver DEPLOY.md).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { startFakeStripe } from '../fake-stripe.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const admin = createClient('http://127.0.0.1:54321', SERVICE, { auth: { persistSession: false } });
const PW = 'Senha-Forte-123';
const run = Date.now().toString(36);
const procs = [];
let browser;

function serve(port, local) {
  const p = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port), LOCAL_SUPABASE: local ? '1' : '' }, stdio: 'pipe' });
  procs.push(p);
  return new Promise((res) => p.stdout.on('data', (d) => { if (String(d).includes('GymApp em')) res(); }));
}
function dayKey(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function newPage(base, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('dialog', (d) => { page.errors.push('dialog: ' + d.message()); d.dismiss(); });
  if (seed) await ctx.addInitScript((s) => { for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, seed);
  await page.goto(base);
  await page.waitForSelector('#splash', { state: 'detached' });
  return page;
}
const isOpen = (page, id) => page.$eval('#' + id, (el) => el.classList.contains('open'));

before(async () => {
  browser = await chromium.launch();
  await serve(5174, false);
});
after(async () => {
  await browser?.close();
  procs.forEach((p) => p.kill());
});

describe('Plano Free (sem backend)', () => {
  const BASE = 'http://127.0.0.1:5174/';

  test('abre sem erros e respeita a CSP', async () => {
    const page = await newPage(BASE);
    const csp = await page.evaluate(async () => (await fetch('/')).headers.get('content-security-policy'));
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('Progresso, Copiar e Importar abrem o paywall', async () => {
    const page = await newPage(BASE);
    await page.click('.nav-btn[data-view=progress]');
    assert.equal(await isOpen(page, 'paywallBackdrop'), true);
    assert.equal(await page.$eval('#view-progress', (e) => e.classList.contains('active')), false);
    await page.click('#paywallClose');
    await page.click('#btnCopyDay');
    assert.equal(await isOpen(page, 'paywallBackdrop'), true);
    assert.equal(await isOpen(page, 'copyModalBackdrop'), false);
    await page.click('#paywallClose');
    await page.click('.nav-btn[data-view=profile]');
    await page.click('#btnImportWorkouts');
    assert.equal(await isOpen(page, 'paywallBackdrop'), true);
    await page.context().close();
  });

  test('Exportar backup continua liberado no Free (portabilidade/LGPD)', async () => {
    const page = await newPage(BASE);
    await page.click('.nav-btn[data-view=profile]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportWorkouts')]);
    assert.match(dl.suggestedFilename(), /^gymapp-backup-.*\.json$/);
    await page.context().close();
  });

  test('Histórico: Free vê só os últimos 7 dias', async () => {
    const mk = (date, name) => ({ date, dayIdx: 1, exercises: [{ name, sets: [{ reps: '10', load: '50' }] }] });
    const page = await newPage(BASE, {
      'gymapp:sessions': [mk(dayKey(-40), 'Antigo A'), mk(dayKey(-10), 'Antigo B'), mk(dayKey(-2), 'Recente')],
      'gymapp:attendance': { [dayKey(-40)]: true, [dayKey(-10)]: true, [dayKey(-2)]: true },
    });
    await page.click('.nav-btn[data-view=history]');
    assert.equal(await page.$$eval('.history-card', (c) => c.length), 1);
    assert.match(await page.textContent('.history-locked'), /\+ 2 treinos mais antigos/);
    assert.match(await page.textContent('#historyCount'), /3 treinos/);
    await page.context().close();
  });

  test('Biblioteca: 5 por grupo liberados (40 no total), resto com cadeado', async () => {
    const page = await newPage(BASE);
    await page.click('#btnAddExercise');
    await page.click('#btnOpenLibrary');
    const free = await page.$$eval('.lib-item:not(.locked)', (x) => x.length);
    const locked = await page.$$eval('.lib-item.locked', (x) => x.length);
    assert.equal(free, 40);
    assert.ok(locked >= 60, 'locked=' + locked);
    await page.fill('#librarySearch', 'supino reto');
    await page.click('.lib-item:not(.locked)');
    assert.equal(await page.inputValue('#exNameInput'), 'Supino reto com barra');
    await page.click('#modalSave');
    assert.match(await page.textContent('#exerciseList'), /Supino reto com barra|/);
    // item bloqueado leva ao paywall
    await page.click('#btnAddExercise');
    await page.click('#btnOpenLibrary');
    await page.click('.lib-item.locked');
    assert.equal(await isOpen(page, 'paywallBackdrop'), true);
    await page.context().close();
  });

  test('XSS: nome de exercício malicioso é exibido como texto', async () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    const page = await newPage(BASE, {
      'gymapp:sessions': [{ date: dayKey(-1), dayIdx: 1, exercises: [{ name: evil, sets: [{ reps: '<b>1</b>', load: '"><svg onload=window.__xss=2>' }] }] }],
      'gymapp:attendance': { [dayKey(-1)]: true },
      'gymapp:workouts': { 1: { name: '<script>window.__xss=3</script>', exercises: [{ id: 'a', name: evil, sets: [{ reps: '1', load: '1' }] }] } },
    });
    await page.click('.nav-btn[data-view=history]');
    await page.click('.history-card summary');
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.$$eval('#historyList img, #historyList svg', (x) => x.length), 0);
    assert.match(await page.textContent('#historyList'), /<img src=x/);
    await page.context().close();
  });

  test('Forjar o cache do plano sem login não libera o Premium', async () => {
    const page = await newPage(BASE, {
      'gymapp:plan': { userId: 'qualquer', status: 'active', periodEnd: '2099-01-01T00:00:00Z' },
    });
    await page.click('.nav-btn[data-view=progress]');
    assert.equal(await isOpen(page, 'paywallBackdrop'), true);
    await page.context().close();
  });
});

describe('Com Supabase local (conta, Premium, sync)', () => {
  const BASE = 'http://127.0.0.1:5173/';
  const email = `e2e-${run}@teste.dev`;
  let fake, userId, dev1;

  before(async () => {
    fake = await startFakeStripe(12111);
    await serve(5173, true);
  });
  after(async () => {
    fake?.close();
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  });

  async function confirmLinkFor(to) {
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent('to:' + to)}`).then((x) => x.json());
      if (r.messages?.length) {
        const msg = await fetch(`http://127.0.0.1:54324/api/v1/message/${r.messages[0].ID}`).then((x) => x.json());
        const m = /(http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s"<)]+)/.exec(msg.Text || msg.HTML);
        if (m) return m[1].replace(/&amp;/g, '&');
      }
      await new Promise((r2) => setTimeout(r2, 500));
    }
    throw new Error('e-mail de confirmação não chegou');
  }
  async function login(page, mail) {
    await page.click('.nav-btn[data-view=profile]');
    await page.click('#accountActions .btn-primary'); // Entrar
    await page.fill('#authEmail', mail);
    await page.fill('#authPassword', PW);
    await page.click('#authSubmit');
  }

  test('cadastro exige termos, senha forte e confirma o e-mail', async () => {
    dev1 = await newPage(BASE);
    await dev1.click('.nav-btn[data-view=profile]');
    await dev1.click('#accountActions .btn-secondary'); // Criar conta
    await dev1.fill('#authEmail', email);
    await dev1.fill('#authPassword', 'fraca');
    await dev1.click('#authSubmit');
    assert.match(await dev1.textContent('#authMsg'), /Senha fraca/);
    await dev1.fill('#authPassword', PW);
    await dev1.click('#authSubmit');
    assert.match(await dev1.textContent('#authMsg'), /aceite os Termos/);
    await dev1.check('#authTerms');
    await dev1.click('#authSubmit');
    await dev1.waitForFunction(() => /link de confirmação/.test(document.getElementById('authMsg').textContent));
    // sem confirmar o e-mail, não entra
    await dev1.fill('#authPassword', PW);
    await dev1.click('#authSubmit');
    await dev1.waitForFunction(() => /Confirme seu e-mail/.test(document.getElementById('authMsg').textContent));
    await dev1.click('#authCancel');

    const link = await confirmLinkFor(email);
    await dev1.goto(link);
    await dev1.waitForSelector('#splash', { state: 'detached' });
    await dev1.click('.nav-btn[data-view=profile]');
    await dev1.waitForFunction((e) => document.getElementById('accountTitle').textContent === e, email);
    assert.equal(await dev1.textContent('#planBadge'), 'Free');
    assert.equal(new URL(dev1.url()).search, '', 'URL limpa após o login');
    userId = (await admin.from('profiles').select('id, stripe_customer_id').limit(100)).data
      .find(Boolean) && (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email).id;
    assert.ok(userId);
  });

  test('assinar: vai para o Checkout do Stripe com 7 dias grátis', async () => {
    await dev1.route('https://checkout.stripe.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout (fake)</h1>' }));
    await dev1.click('#accountActions .btn-primary'); // Testar Premium grátis
    assert.equal(await dev1.textContent('#paywallCta'), 'Testar 7 dias grátis');
    await dev1.click('.plan-opt[data-interval=month]');
    await Promise.all([dev1.waitForURL(/checkout\.stripe\.com/), dev1.click('#paywallCta')]);
    const cs = fake.state.checkouts.at(-1).params;
    assert.equal(cs['subscription_data[trial_period_days]'], '7');
    assert.equal(cs['line_items[0][price]'], 'price_month');
  });

  test('Premium ativo: libera Progresso e sincroniza na nuvem', async () => {
    // simula o webhook do Stripe confirmando o trial
    await admin.from('profiles').update({ subscription_status: 'trialing', current_period_end: new Date(Date.now() + 7 * 864e5).toISOString(), trial_used: true }).eq('id', userId);
    await dev1.goto(BASE + '?checkout=success');
    await dev1.waitForSelector('#splash', { state: 'detached' });
    await dev1.waitForFunction(() => document.getElementById('navProgressLock').hidden === true, null, { timeout: 15000 });
    await dev1.click('.nav-btn[data-view=progress]');
    assert.equal(await dev1.$eval('#view-progress', (e) => e.classList.contains('active')), true);

    await dev1.click('.nav-btn[data-view=home]');
    await dev1.click('#btnAddExercise');
    await dev1.fill('#exNameInput', 'Remada do aparelho 1');
    await dev1.click('#modalSave');
    await dev1.click('.nav-btn[data-view=profile]');
    await dev1.click('text=Sincronizar agora');
    await dev1.waitForFunction(() => /Sincronizado/.test(document.getElementById('toastMsg').textContent));
    const { data } = await admin.from('user_data').select('data, rev').eq('user_id', userId).single();
    assert.match(JSON.stringify(data.data.workouts), /Remada do aparelho 1/);
    assert.doesNotMatch(await dev1.textContent('#accountSync'), /pendentes/);
  });

  test('2º aparelho com dados próprios: pergunta qual versão manter', async () => {
    const dev2 = await newPage(BASE, { 'gymapp:workouts': { 3: { name: '', exercises: [{ id: 'z', name: 'Treino local do aparelho 2', sets: [] }] } } });
    await login(dev2, email);
    await dev2.waitForSelector('#syncModalBackdrop.open', { timeout: 15000 });
    assert.match(await dev2.textContent('#syncCloudInfo'), /1 exercícios na ficha/);
    await dev2.click('#syncChooseCloud');
    await dev2.click('.nav-btn[data-view=home]');
    const all = await dev2.evaluate(() => localStorage.getItem('gymapp:workouts'));
    assert.match(all, /Remada do aparelho 1/);
    assert.doesNotMatch(all, /Treino local do aparelho 2/);

    // edição no aparelho 2 chega ao aparelho 1 (vale a mais recente)
    await dev2.click('#btnAddExercise');
    await dev2.fill('#exNameInput', 'Novo no aparelho 2');
    await dev2.click('#modalSave');
    await dev2.click('.nav-btn[data-view=profile]');
    await dev2.click('text=Sincronizar agora');
    await dev2.waitForFunction(() => /Sincronizado/.test(document.getElementById('toastMsg').textContent));
    await dev1.reload();
    await dev1.waitForSelector('#splash', { state: 'detached' });
    await dev1.waitForFunction(() => /Novo no aparelho 2/.test(localStorage.getItem('gymapp:workouts') || ''), null, { timeout: 15000 });
    await dev2.context().close();
  });

  test('sair bloqueia o Premium de novo e mantém os dados locais', async () => {
    await dev1.click('.nav-btn[data-view=profile]');
    await dev1.click('#accountActions >> text=Sair');
    await dev1.click('#confirmModalOk');
    await dev1.waitForFunction(() => document.getElementById('planBadge').textContent === 'Free');
    assert.equal(await dev1.evaluate(() => localStorage.getItem('gymapp:plan')), null);
    assert.match(await dev1.evaluate(() => localStorage.getItem('gymapp:workouts')), /Remada do aparelho 1/);
    await dev1.click('.nav-btn[data-view=progress]');
    assert.equal(await isOpen(dev1, 'paywallBackdrop'), true);
    assert.deepEqual(dev1.errors.filter((e) => !/Failed to load resource/.test(e)), []);
    await dev1.context().close();
  });
});
