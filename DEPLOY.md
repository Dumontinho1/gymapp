# Lançando o GymApp (tudo no plano gratuito)

Custos: Supabase Free, Stripe (só taxa por venda, sem mensalidade) e Vercel Hobby. Todos são R$ 0 até você vender.

## 1. Supabase (login + banco)
1. Crie um projeto em https://supabase.com (região: São Paulo).
2. No seu computador:
   ```bash
   npm install
   npx supabase login
   npx supabase link --project-ref SEU_REF
   npx supabase db push          # aplica supabase/migrations
   ```
3. No painel, em **Authentication → URL Configuration**:
   - Site URL: `https://SEU-DOMINIO.vercel.app`
   - Redirect URLs: `https://SEU-DOMINIO.vercel.app/**`
4. Em **Authentication → Providers → Email**, deixe ligado *Confirm email*. Em **Policies**, deixe a senha mínima de 8 caracteres, com letras maiúsculas, minúsculas e números.
5. Para mandar e-mails de verdade, configure um SMTP em **Auth → SMTP**. O SMTP padrão do Supabase envia poucos e-mails por hora. O Resend ou o Brevo têm plano grátis.

## 2. Stripe (pagamentos)
1. Crie a conta em https://stripe.com/br e ative os pagamentos no Brasil.
2. Em **Products**, crie o produto "GymApp Premium" com 2 preços recorrentes:
   - R$ 5,90 por mês, e anote o `price_...`
   - R$ 49,90 por ano, e anote o `price_...`
3. Em **Settings → Billing → Customer portal**, ative: cancelar assinatura, trocar de plano (mensal ↔ anual) e atualizar o cartão.
4. Em **Developers → Webhooks**, adicione o endpoint
   `https://SEU_REF.supabase.co/functions/v1/stripe-webhook` com os eventos
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
   `customer.subscription.trial_will_end`, `invoice.paid` e `invoice.payment_failed`. Anote o `whsec_...`.
5. Comece no **modo de teste** (chaves `sk_test_`) e só troque para o modo live quando tudo estiver funcionando.

## 3. Edge Functions
```bash
cp supabase/functions/.env.example supabase/functions/.env   # preencha os valores (NUNCA commite este arquivo)
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy
```

## 4. App na Vercel
```bash
SUPABASE_URL=https://SEU_REF.supabase.co SUPABASE_ANON_KEY=sb_publishable_... node scripts/configure.mjs
```
Esse comando preenche o `config.js` e a CSP do `vercel.json`. Depois, faça o commit e importe o repositório na Vercel (framework: **Other**, sem build). Por último, ajuste `APP_URL` e `ALLOWED_ORIGINS` nos secrets para o domínio final.

## 5. Antes de abrir para o público
- Preencha os campos `[PREENCHER: ...]` em `termos.html` e `privacidade.html` (nome ou CNPJ e e-mail de contato). O ideal é um advogado revisar.
- Faça uma compra de teste completa com o cartão `4242 4242 4242 4242`: assinar, conferir se o Premium foi ativado, cancelar pelo portal e excluir a conta.
- A cada atualização do app, aumente o número de `CACHE` em `sw.js` e de `OFFLINE_CACHE` em `app.js`.

## Testes locais
```bash
npx supabase start
npx supabase functions serve --env-file supabase/functions/.env.test
npm test            # RLS + Edge Functions (Stripe falso)
npm run test:e2e    # navegador real (Playwright)
```
