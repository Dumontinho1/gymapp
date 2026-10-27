// Stripe falso (só os endpoints que as Edge Functions usam), com estado em
// memória, para testar checkout/trial/webhook/exclusão sem chaves reais.
import http from 'node:http';

export function startFakeStripe(port = 12111) {
  const state = { customers: {}, subs: [], checkouts: [], portals: [], canceled: [], seq: 0 };
  const id = (p) => `${p}_${(++state.seq).toString(36)}`;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const form = Object.fromEntries(new URLSearchParams(raw));
      const q = Object.fromEntries(url.searchParams);
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const p = url.pathname;
      let m;

      if (!/^Bearer sk_test_/.test(req.headers.authorization || '')) return send(401, { error: { message: 'bad key' } });

      if (req.method === 'POST' && p === '/v1/customers') {
        const c = { id: id('cus'), object: 'customer', email: form.email, metadata: { supabase_user_id: form['metadata[supabase_user_id]'] } };
        state.customers[c.id] = c;
        return send(200, c);
      }
      if (req.method === 'GET' && (m = p.match(/^\/v1\/customers\/(\w+)$/))) {
        const c = state.customers[m[1]];
        return c ? send(200, c) : send(404, { error: { message: 'no such customer' } });
      }
      if (req.method === 'GET' && p === '/v1/subscriptions') {
        const data = state.subs.filter((s) => s.customer === q.customer).sort((a, b) => b.created - a.created);
        return send(200, { object: 'list', data: data.slice(0, Number(q.limit || 10)), has_more: false });
      }
      if (req.method === 'DELETE' && (m = p.match(/^\/v1\/subscriptions\/(\w+)$/))) {
        const s = state.subs.find((x) => x.id === m[1]);
        if (!s) return send(404, { error: { message: 'no such sub' } });
        s.status = 'canceled';
        state.canceled.push(s.id);
        return send(200, s);
      }
      if (req.method === 'POST' && p === '/v1/checkout/sessions') {
        const cs = { id: id('cs'), object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/' + id('cs_test'), params: form };
        state.checkouts.push(cs);
        return send(200, cs);
      }
      if (req.method === 'POST' && p === '/v1/billing_portal/sessions') {
        const ps = { id: id('bps'), url: 'https://billing.stripe.com/p/session/' + id('test'), params: form };
        state.portals.push(ps);
        return send(200, ps);
      }
      return send(404, { error: { message: 'fake stripe: rota não implementada ' + req.method + ' ' + p } });
    });
  });

  // "Cria" uma assinatura do lado do Stripe (simula o cliente pagando no Checkout)
  state.addSub = ({ customer, status = 'active', trial = false, interval = 'month', days = 30, created }) => {
    const now = Math.floor(Date.now() / 1000);
    const s = {
      id: id('sub'), object: 'subscription', customer, status,
      created: created ?? now + state.seq,
      trial_start: trial ? now : null,
      cancel_at_period_end: false, cancel_at: null, metadata: {},
      items: { object: 'list', data: [{ id: id('si'), current_period_end: now + days * 86400, price: { id: 'price_' + interval, recurring: { interval } } }] },
    };
    state.subs.push(s);
    return s;
  };

  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve({ state, close: () => server.close() })));
}
