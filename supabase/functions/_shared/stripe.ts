import Stripe from 'npm:stripe@23.0.1';
import { adminClient } from './http.ts';

let stripe: Stripe | null = null;
export function stripeClient(): Stripe {
  if (!stripe) {
    // STRIPE_API_HOST só é definido nos testes locais (Stripe falso); em
    // produção fica vazio e o SDK usa api.stripe.com.
    const testHost = Deno.env.get('STRIPE_API_HOST');
    stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 2,
      ...(testHost ? {
        host: testHost,
        port: Number(Deno.env.get('STRIPE_API_PORT') ?? '443'),
        protocol: (Deno.env.get('STRIPE_API_PROTOCOL') ?? 'https') as 'http' | 'https',
      } : {}),
    });
  }
  return stripe;
}

export function priceFor(interval: string): string | null {
  if (interval === 'month') return Deno.env.get('STRIPE_PRICE_MONTHLY') ?? null;
  if (interval === 'year') return Deno.env.get('STRIPE_PRICE_YEARLY') ?? null;
  return null;
}

export interface ProfileRow {
  id: string;
  stripe_customer_id: string | null;
  subscription_id: string | null;
  subscription_status: string;
  current_period_end: string | null;
  trial_used: boolean;
}

export async function getProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await adminClient().from('profiles').select('*').eq('id', userId).single();
  if (error || !data) throw new Error('profile não encontrado: ' + (error?.message ?? userId));
  return data as ProfileRow;
}

export async function isPremium(userId: string): Promise<boolean> {
  const { data, error } = await adminClient().rpc('is_premium', { p_user: userId });
  if (error) throw error;
  return data === true;
}

const LIVE = new Set(['active', 'trialing', 'past_due']);
const RANK: Record<string, number> = { active: 3, trialing: 3, past_due: 2 };

/* Escolhe a assinatura que representa o cliente: a "viva" mais antiga (é a
   que o usuário assinou primeiro), senão a mais recente de todas. */
function pickSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (!subs.length) return null;
  const live = subs.filter((s) => LIVE.has(s.status))
    .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || a.created - b.created);
  if (live.length) return live[0];
  return [...subs].sort((a, b) => b.created - a.created)[0];
}

function periodEnd(sub: Stripe.Subscription): number | null {
  // Nas versões novas da API o fim do período fica no item da assinatura.
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  return item?.current_period_end ?? legacy ?? null;
}

/* Fonte da verdade = Stripe. Em vez de confiar na ordem/conteúdo do evento,
   relê as assinaturas do cliente e grava o estado atual no profile. Isso
   torna o webhook idempotente e imune a eventos fora de ordem. */
export async function syncCustomer(customerId: string, hintUserId?: string | null): Promise<void> {
  const db = adminClient();
  const s = stripeClient();

  let { data: profile } = await db.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle();
  if (!profile) {
    const customer = await s.customers.retrieve(customerId);
    const metaUser = !('deleted' in customer && customer.deleted)
      ? (customer as Stripe.Customer).metadata?.supabase_user_id : null;
    const userId = metaUser || hintUserId;
    if (!userId) { console.warn('cliente Stripe sem usuário vinculado', customerId); return; }
    const { data: p } = await db.from('profiles').select('id, stripe_customer_id').eq('id', userId).maybeSingle();
    if (!p) { console.warn('usuário inexistente para cliente', customerId); return; }
    if (p.stripe_customer_id && p.stripe_customer_id !== customerId) {
      console.warn('usuário já vinculado a outro cliente Stripe', userId);
      return;
    }
    await db.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
    profile = { id: userId };
  }

  const list = await s.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  const subs = list.data;

  // Proteção contra assinatura dupla (duas abas de checkout ao mesmo tempo):
  // mantém só a primeira e cancela as outras.
  const live = subs.filter((x) => x.status === 'active' || x.status === 'trialing')
    .sort((a, b) => a.created - b.created);
  for (const extra of live.slice(1)) {
    await s.subscriptions.cancel(extra.id, { prorate: true });
    extra.status = 'canceled';
  }

  const sub = pickSubscription(subs);
  const end = sub ? periodEnd(sub) : null;
  const update = sub ? {
    subscription_id: sub.id,
    subscription_status: sub.status,
    plan_interval: sub.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'year' : 'month',
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end || !!sub.cancel_at,
  } : {
    subscription_id: null, subscription_status: 'none', plan_interval: null,
    current_period_end: null, cancel_at_period_end: false,
  };
  const { error } = await db.from('profiles').update(update).eq('id', profile.id);
  if (error) throw error;

  if (subs.some((x) => x.trial_start)) {
    const { error: e2 } = await db.rpc('mark_trial_used', { p_user: profile.id });
    if (e2) throw e2;
  }
}
