// Cria uma sessão do Stripe Checkout para assinar o Premium.
// Entrada: { interval: 'month' | 'year' }. Saída: { url }.
import { appUrl, handler, HttpError, json, readJson, requireUser, adminClient } from '../_shared/http.ts';
import { getProfile, isPremium, priceFor, stripeClient } from '../_shared/stripe.ts';

const TRIAL_DAYS = 7;

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  if (!user.email_confirmed_at) throw new HttpError(403, 'email_not_confirmed');

  const body = await readJson(req);
  const interval = body.interval;
  if (interval !== 'month' && interval !== 'year') throw new HttpError(400, 'invalid_interval');
  const price = priceFor(interval);
  if (!price) throw new Error('preço do Stripe não configurado para ' + interval);

  if (await isPremium(user.id)) throw new HttpError(409, 'already_premium');

  const stripe = stripeClient();
  const profile = await getProfile(user.id);

  let customerId = profile.stripe_customer_id;
  if (!customerId) {
    // idempotencyKey: duas chamadas simultâneas não criam dois clientes
    const customer = await stripe.customers.create(
      { email: user.email, metadata: { supabase_user_id: user.id } },
      { idempotencyKey: 'customer-' + user.id },
    );
    customerId = customer.id;
    const { error } = await adminClient().from('profiles')
      .update({ stripe_customer_id: customerId }).eq('id', user.id).is('stripe_customer_id', null);
    if (error) throw error;
  }

  // Trial só uma vez: nem a conta (nem o e-mail, via ledger) pode ter usado,
  // nem pode existir qualquer assinatura anterior desse cliente no Stripe.
  let trialEligible = !profile.trial_used;
  if (trialEligible) {
    const prior = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
    if (prior.data.length) trialEligible = false;
  }

  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    payment_method_collection: 'always',
    allow_promotion_codes: true,
    locale: 'pt-BR',
    subscription_data: {
      metadata: { supabase_user_id: user.id },
      ...(trialEligible ? {
        trial_period_days: TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      } : {}),
    },
    // URLs fixas do servidor (nunca vindas do cliente) — evita open redirect.
    success_url: base + '/?checkout=success',
    cancel_url: base + '/?checkout=cancel',
  });

  return json(req, 200, { url: session.url, trial: trialEligible });
}));
