// Recebe eventos do Stripe. A assinatura (Stripe-Signature) é verificada
// antes de qualquer coisa; só então o estado do cliente é ressincronizado.
// Configure no Stripe: endpoint = <SUPABASE_URL>/functions/v1/stripe-webhook
import Stripe from 'npm:stripe@23.0.1';
import { adminClient } from '../_shared/http.ts';
import { stripeClient, syncCustomer } from '../_shared/stripe.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();
const MAX_BODY_BYTES = 512 * 1024;

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
]);

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text(405, 'method not allowed');
  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return text(400, 'missing signature');

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return text(413, 'too large');

  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(
      body, signature, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider,
    );
  } catch {
    return text(400, 'invalid signature');
  }

  if (!HANDLED.has(event.type)) return text(200, 'ignored');

  const db = adminClient();
  const { data: seen } = await db.from('stripe_events').select('id').eq('id', event.id).maybeSingle();
  if (seen) return text(200, 'duplicate');

  // deno-lint-ignore no-explicit-any
  const obj = event.data.object as any;
  const customerId: string | null = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id ?? null;
  const hintUser: string | null = obj.client_reference_id ?? obj.metadata?.supabase_user_id ?? null;

  try {
    if (customerId) await syncCustomer(customerId, hintUser);
  } catch (e) {
    console.error('falha ao sincronizar', event.type, event.id, e);
    return text(500, 'sync failed'); // Stripe tenta de novo depois
  }

  await db.from('stripe_events').upsert({ id: event.id, type: event.type });
  return text(200, 'ok');
});
