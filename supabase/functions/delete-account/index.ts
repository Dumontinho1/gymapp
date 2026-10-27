// Exclui a conta e todos os dados (LGPD art. 18, VI). Cancela a assinatura
// no Stripe antes, para o usuário nunca ser cobrado de uma conta que não existe.
// Entrada: { confirm: 'EXCLUIR' }.
import { adminClient, handler, HttpError, json, readJson, requireUser } from '../_shared/http.ts';
import { getProfile, stripeClient } from '../_shared/stripe.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  if (body.confirm !== 'EXCLUIR') throw new HttpError(400, 'confirmation_required');

  const profile = await getProfile(user.id);
  if (profile.stripe_customer_id) {
    const stripe = stripeClient();
    const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: 'all', limit: 20 });
    for (const s of subs.data) {
      if (s.status !== 'canceled' && s.status !== 'incomplete_expired') {
        await stripe.subscriptions.cancel(s.id);
      }
    }
    // O cliente no Stripe é mantido: registros fiscais de pagamento têm
    // obrigação legal de guarda (ver Política de Privacidade).
    if (subs.data.some((s) => s.trial_start)) {
      await adminClient().rpc('mark_trial_used', { p_user: user.id });
    }
  }

  // ON DELETE CASCADE remove profiles e user_data.
  const { error } = await adminClient().auth.admin.deleteUser(user.id);
  if (error) throw error;
  return json(req, 200, { deleted: true });
}));
