// Helpers comuns das Edge Functions: CORS restrito, respostas JSON, auth.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.118.0';

const MAX_BODY_BYTES = 8 * 1024;

/* Só as origens listadas (o domínio do app) podem chamar as funções pelo
   navegador. Nunca "*": as funções aceitam o token do usuário. */
function allowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
  if (allowedOrigins().includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/* Erro com status HTTP e um código curto para o app; a mensagem interna
   nunca vai para o cliente. */
export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/* Envolve o handler: preflight CORS, só POST, origem conferida, erros
   convertidos em JSON sem vazar detalhes. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const origin = req.headers.get('Origin');
      if (origin && !allowedOrigins().includes(origin)) throw new HttpError(403, 'origin_not_allowed');
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json(req, e.status, { error: e.code });
      console.error(e);
      return json(req, 500, { error: 'internal_error' });
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('Content-Length') ?? '0');
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

let admin: SupabaseClient | null = null;
/* Cliente com service_role: ignora RLS. Só existe no servidor. */
export function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/* Valida o JWT do header Authorization no Supabase Auth (assinatura e
   expiração são conferidas pelo servidor de auth, não aqui). */
export async function requireUser(req: Request): Promise<User> {
  const auth = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) throw new HttpError(401, 'not_authenticated');
  const { data, error } = await adminClient().auth.getUser(m[1]);
  if (error || !data?.user) throw new HttpError(401, 'not_authenticated');
  return data.user;
}

export function appUrl(): string {
  const url = Deno.env.get('APP_URL');
  if (!url) throw new Error('APP_URL não configurada');
  return url.replace(/\/+$/, '');
}
