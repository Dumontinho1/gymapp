-- GymApp — schema inicial: perfis/assinaturas, dados sincronizados, controle de trial.
--
-- Princípio de segurança: o navegador (roles anon/authenticated) só LÊ os
-- próprios dados. Tudo que define plano/pagamento é escrito exclusivamente
-- pelo backend (service_role, usado nas Edge Functions do Stripe). Escrita
-- de dados sincronizados passa por uma função que confere o plano no servidor.

-- ---------------------------------------------------------------------------
-- PROFILES: um por usuário, criado automaticamente no cadastro.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  stripe_customer_id   text unique,
  subscription_id      text,
  subscription_status  text not null default 'none'
    check (subscription_status in ('none','trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  plan_interval        text check (plan_interval in ('month','year')),
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_used           boolean not null default false
);

alter table public.profiles enable row level security;

create policy "profiles: ler o próprio"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- Sem policies de insert/update/delete: o cliente não altera plano. Defesa em
-- profundidade: também tira os privilégios de escrita no nível de GRANT.
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
revoke all on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- TRIAL LEDGER: impede repetir o teste grátis na mesma conta/e-mail, inclusive
-- depois de excluir a conta e cadastrar de novo. Guarda só um hash SHA-256 do
-- e-mail normalizado (não o e-mail em si).
-- ---------------------------------------------------------------------------
create table public.trial_ledger (
  email_hash text primary key,
  used_at    timestamptz not null default now()
);
alter table public.trial_ledger enable row level security;
revoke all on public.trial_ledger from anon, authenticated;

-- Normaliza para pegar variações do mesmo endereço:
--   Fulano+teste@Gmail.com, f.u.l.a.n.o@googlemail.com  ->  fulano@gmail.com
create or replace function public.normalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local  text;
  v_domain text;
begin
  if p_email is null or position('@' in p_email) = 0 then
    return lower(trim(coalesce(p_email, '')));
  end if;
  v_local  := split_part(lower(trim(p_email)), '@', 1);
  v_domain := split_part(lower(trim(p_email)), '@', 2);
  v_local  := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end;
$$;

create or replace function public.email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(public.normalize_email(p_email), 'sha256'), 'hex');
$$;

-- Cria o profile no cadastro; se esse e-mail já usou trial antes, já nasce marcado.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, trial_used)
  values (
    new.id,
    exists (select 1 from public.trial_ledger t where t.email_hash = public.email_hash(new.email))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- PREMIUM: regra única usada pelo banco e pelas funções.
-- 2 dias de tolerância para atraso de webhook na renovação.
-- ---------------------------------------------------------------------------
create or replace function public.is_premium(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and p.subscription_status in ('active', 'trialing')
      and (p.current_period_end is null or p.current_period_end + interval '2 days' > now())
  );
$$;

revoke execute on function public.is_premium(uuid) from public, anon;
grant execute on function public.is_premium(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- USER DATA: snapshot do app (treinos, sessões, recordes...) para o sync.
-- `rev` faz controle de concorrência otimista entre aparelhos.
-- ---------------------------------------------------------------------------
create table public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  rev        bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint user_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint user_data_max_size  check (octet_length(data::text) <= 2000000)
);

alter table public.user_data enable row level security;

-- Leitura do próprio snapshot é sempre permitida (mesmo após o Premium
-- expirar, o usuário consegue recuperar os dados — portabilidade/LGPD).
create policy "user_data: ler o próprio"
  on public.user_data for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete, truncate on public.user_data from anon, authenticated;
revoke all on public.user_data from anon;

-- Única porta de escrita. Confere login + Premium no servidor e rejeita se
-- outro aparelho gravou no meio do caminho (p_base_rev desatualizado).
-- Retorna o novo rev; erro 'conflict' (P0001) indica que é preciso puxar antes.
create or replace function public.push_user_data(p_data jsonb, p_base_rev bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_premium(v_uid) then
    raise exception 'premium_required' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid_data' using errcode = '22023';
  end if;
  if octet_length(p_data::text) > 2000000 then
    raise exception 'data_too_large' using errcode = '54000';
  end if;

  select rev into v_rev from public.user_data where user_id = v_uid for update;

  if not found then
    if coalesce(p_base_rev, 0) <> 0 then
      raise exception 'conflict' using errcode = 'P0001';
    end if;
    insert into public.user_data (user_id, data, rev) values (v_uid, p_data, 1);
    return 1;
  end if;

  if p_base_rev is distinct from v_rev then
    raise exception 'conflict' using errcode = 'P0001';
  end if;

  update public.user_data
     set data = p_data, rev = v_rev + 1, updated_at = now()
   where user_id = v_uid;
  return v_rev + 1;
end;
$$;

revoke execute on function public.push_user_data(jsonb, bigint) from public, anon;
grant execute on function public.push_user_data(jsonb, bigint) to authenticated;

-- Funções internas não devem ser chamáveis pela API pública.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.email_hash(text) from public, anon, authenticated;
revoke execute on function public.normalize_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- STRIPE EVENTS: idempotência do webhook (o Stripe pode reenviar eventos).
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- updated_at automático em profiles
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Chamado pelo webhook quando uma assinatura com trial começa: marca a conta
-- e registra o hash do e-mail no ledger (sobrevive à exclusão da conta).
-- ---------------------------------------------------------------------------
create or replace function public.mark_trial_used(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set trial_used = true where id = p_user;
  insert into public.trial_ledger (email_hash)
    select public.email_hash(u.email) from auth.users u where u.id = p_user and u.email is not null
  on conflict (email_hash) do nothing;
end;
$$;
revoke execute on function public.mark_trial_used(uuid) from public, anon, authenticated;
grant execute on function public.mark_trial_used(uuid) to service_role;
