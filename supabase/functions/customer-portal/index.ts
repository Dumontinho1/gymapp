// Abre o Portal do Cliente do Stripe (trocar cartão, mudar plano, cancelar).
import { appUrl, handler, HttpError, json, requireUser } from '../_shared/http.ts';
import { getProfile, stripeClient } from '../_shared/stripe.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const profile = await getProfile(user.id);
  if (!profile.stripe_customer_id) throw new HttpError(404, 'no_customer');

  const session = await stripeClient().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: appUrl() + '/?portal=return',
    locale: 'pt-BR',
  });
  return json(req, 200, { url: session.url });
}));
