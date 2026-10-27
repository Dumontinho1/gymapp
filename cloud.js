/* GymApp - conta, plano (Free/Premium) e sincronização na nuvem.
   Exposto como window.GymCloud; app.js continua dono do estado e só pluga
   seus getters/setters aqui (attachApp). Sem config.js preenchido, tudo isso
   fica desligado e o app segue 100% local no plano Free. */
(function(){
  'use strict';

  var LS_PLAN = 'gymapp:plan';   // cache do plano para funcionar offline
  var LS_SYNC = 'gymapp:sync';   // { userId, rev, dirty, localUpdatedAt, lastSyncAt }
  var PREMIUM_GRACE_MS = 2 * 86400000; // mesma tolerância do is_premium() no banco
  var PUSH_DEBOUNCE = 4000;

  var cfg = window.GYMAPP_CONFIG || {};
  var enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  var client = null;
  if(enabled){
    try{
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'gymapp:auth' }
      });
    }catch(e){ enabled = false; client = null; }
  }

  function loadJSON(key, fallback){
    try{ var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }catch(e){ return fallback; }
  }
  function saveJSON(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
  }
  function isObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }

  var app = null;          // hooks registrados pelo app.js
  var user = null;
  var plan = loadJSON(LS_PLAN, null);
  if(!isObj(plan)) plan = null;
  var sync = loadJSON(LS_SYNC, null);
  if(!isObj(sync)) sync = { userId: null, rev: 0, dirty: false, localUpdatedAt: 0, lastSyncAt: 0 };
  var listeners = [];
  var pushTimer = null;
  var inflight = null; // sync em andamento (outra chamada espera por ele e roda de novo)
  var applyingRemote = false;

  function emit(){ listeners.forEach(function(fn){ try{ fn(); }catch(e){} }); }
  function persistSync(){ saveJSON(LS_SYNC, sync); }

  /* ---------- PLANO ---------- */
  function computePremium(p){
    if(!p || (p.status !== 'active' && p.status !== 'trialing')) return false;
    if(!p.periodEnd) return true;
    return new Date(p.periodEnd).getTime() + PREMIUM_GRACE_MS > Date.now();
  }
  function isPremium(){
    return !!(user && plan && plan.userId === user.id && computePremium(plan));
  }

  /* Lê o profile (RLS: só o próprio) e guarda em cache. Offline, o cache
     vale até o fim do período pago + tolerância. */
  function refreshPlan(){
    if(!client || !user) return Promise.resolve(plan);
    return client.from('profiles')
      .select('subscription_status, plan_interval, current_period_end, cancel_at_period_end, trial_used, stripe_customer_id')
      .eq('id', user.id).single()
      .then(function(res){
        if(res.error || !res.data) return plan;
        var d = res.data;
        plan = {
          userId: user.id,
          status: d.subscription_status,
          interval: d.plan_interval,
          periodEnd: d.current_period_end,
          cancelAtPeriodEnd: !!d.cancel_at_period_end,
          trialUsed: !!d.trial_used,
          hasCustomer: !!d.stripe_customer_id,
          checkedAt: Date.now()
        };
        saveJSON(LS_PLAN, plan);
        emit();
        return plan;
      }, function(){ return plan; });
  }

  /* ---------- AUTH ---------- */
  function friendlyAuthError(err){
    var m = ((err && (err.code || err.message)) || '').toLowerCase();
    if(m.indexOf('invalid login') > -1 || m.indexOf('invalid_credentials') > -1) return 'E-mail ou senha incorretos.';
    if(m.indexOf('email not confirmed') > -1 || m.indexOf('email_not_confirmed') > -1) return 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).';
    if(m.indexOf('already registered') > -1 || m.indexOf('user_already_exists') > -1) return 'Este e-mail já tem conta. Tente entrar.';
    if(m.indexOf('weak') > -1 || m.indexOf('password') > -1) return 'Senha fraca: use 8+ caracteres com maiúscula, minúscula e número.';
    if(m.indexOf('rate') > -1 || m.indexOf('too many') > -1 || m.indexOf('over_') > -1) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    if(m.indexOf('fetch') > -1 || m.indexOf('network') > -1) return 'Sem conexão com o servidor.';
    return 'Não foi possível concluir. Tente novamente.';
  }
  function redirectUrl(){ return location.origin + location.pathname; }

  function signUp(email, password){
    return client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: redirectUrl() } })
      .then(function(res){
        if(res.error) throw new Error(friendlyAuthError(res.error));
        // Com confirmação de e-mail ligada, não há sessão até clicar no link.
        // identities vazio = e-mail já cadastrado (o Supabase não revela isso por erro).
        var u = res.data && res.data.user;
        if(u && Array.isArray(u.identities) && u.identities.length === 0) throw new Error('Este e-mail já tem conta. Tente entrar.');
        return { needsConfirmation: !(res.data && res.data.session) };
      });
  }
  function signIn(email, password){
    return client.auth.signInWithPassword({ email: email, password: password })
      .then(function(res){ if(res.error) throw new Error(friendlyAuthError(res.error)); return res.data; });
  }
  function resetPassword(email){
    return client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() })
      .then(function(res){ if(res.error) throw new Error(friendlyAuthError(res.error)); });
  }
  function updatePassword(pw){
    return client.auth.updateUser({ password: pw })
      .then(function(res){ if(res.error) throw new Error(friendlyAuthError(res.error)); });
  }
  /* Sair apaga o cache do plano e o vínculo de sync deste aparelho. Os dados
     locais continuam no celular (o usuário pode seguir no Free). */
  function signOut(){
    if(pushTimer){ clearTimeout(pushTimer); pushTimer = null; }
    flushApp();
    var flush = (isPremium() && sync.dirty) ? pushNow().catch(function(){}) : Promise.resolve();
    return flush.then(function(){ return client.auth.signOut(); }).then(function(){
      user = null; plan = null;
      try{ localStorage.removeItem(LS_PLAN); }catch(e){}
      sync = { userId: null, rev: 0, dirty: false, localUpdatedAt: sync.localUpdatedAt, lastSyncAt: 0 };
      persistSync();
      emit();
    });
  }

  /* ---------- EDGE FUNCTIONS (Stripe / conta) ---------- */
  function callFunction(name, body){
    return client.functions.invoke(name, { body: body || {} }).then(function(res){
      if(res.error){
        var ctx = res.error.context;
        if(ctx && typeof ctx.json === 'function'){
          return ctx.json().then(function(j){ throw new Error((j && j.error) || 'request_failed'); },
            function(){ throw new Error('request_failed'); });
        }
        throw new Error('request_failed');
      }
      return res.data;
    });
  }
  function safeRedirect(url){
    // Só segue para domínios do Stripe — nunca para um destino arbitrário.
    if(typeof url === 'string' && /^https:\/\/(checkout|billing)\.stripe\.com\//.test(url)){ location.assign(url); return; }
    throw new Error('invalid_redirect');
  }
  function startCheckout(interval){
    return callFunction('create-checkout', { interval: interval === 'year' ? 'year' : 'month' })
      .then(function(d){ safeRedirect(d && d.url); });
  }
  function openPortal(){
    return callFunction('customer-portal').then(function(d){ safeRedirect(d && d.url); });
  }
  function deleteAccount(){
    return callFunction('delete-account', { confirm: 'EXCLUIR' }).then(function(){
      return client.auth.signOut().catch(function(){});
    }).then(function(){
      user = null; plan = null;
      try{ localStorage.removeItem(LS_PLAN); localStorage.removeItem(LS_SYNC); }catch(e){}
      sync = { userId: null, rev: 0, dirty: false, localUpdatedAt: 0, lastSyncAt: 0 };
      emit();
    });
  }

  /* ---------- SYNC ----------
     O snapshot inteiro do app vai para user_data (jsonb). Escrita só pela RPC
     push_user_data, que confere Premium no servidor e o `rev` (concorrência
     otimista). Primeira vez num aparelho com dados dos dois lados: pergunta
     ao usuário. Depois: vale a alteração mais recente. */
  function notifyLocalChange(){
    if(applyingRemote) return;
    sync.dirty = true;
    sync.localUpdatedAt = Date.now();
    persistSync();
    schedulePush();
  }
  function schedulePush(){
    if(!isPremium() || sync.userId !== (user && user.id)) return;
    if(pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){ pushTimer = null; syncNow().catch(function(){}); }, PUSH_DEBOUNCE);
  }

  function pushNow(){
    var data = app.getState();
    return client.rpc('push_user_data', { p_data: data, p_base_rev: sync.rev || 0 }).then(function(res){
      if(res.error){
        var e = new Error(res.error.message || 'push_failed');
        e.conflict = /conflict/.test(res.error.message || '');
        throw e;
      }
      sync.rev = res.data;
      sync.dirty = false;
      sync.lastSyncAt = Date.now();
      persistSync();
      emit();
    });
  }

  function applyRemote(row){
    applyingRemote = true;
    try{ app.applyState(row.data); }
    finally{ applyingRemote = false; }
    sync.rev = row.rev;
    sync.dirty = false;
    sync.localUpdatedAt = new Date(row.updated_at).getTime();
    sync.lastSyncAt = Date.now();
    persistSync();
    emit();
  }

  function fetchRemote(){
    return client.from('user_data').select('data, rev, updated_at').eq('user_id', user.id).maybeSingle()
      .then(function(res){ if(res.error) throw res.error; return res.data; });
  }

  /* O app grava a ficha com debounce; antes de decidir se há algo a enviar,
     força a gravação pendente para ela contar como alteração local. */
  function flushApp(){ if(app && app.flush) app.flush(); }

  /* Retorna 'synced' | 'skipped'. */
  function syncNow(){
    flushApp();
    if(!client || !user || !isPremium() || !navigator.onLine || !app) return Promise.resolve('skipped');
    if(inflight){
      // não pula: espera o atual e roda de novo, para incluir alterações feitas no meio
      return inflight.catch(function(){}).then(function(){ return syncNow(); });
    }
    var attempts = 0;
    function run(){
      attempts++;
      return fetchRemote().then(function(row){
        var firstOnDevice = sync.userId !== user.id;
        if(firstOnDevice){
          if(!row){ sync.userId = user.id; sync.rev = 0; return pushNow(); }
          if(!app.hasData()){ sync.userId = user.id; applyRemote(row); return; }
          return app.askSyncChoice(app.summarize(app.getState()), app.summarize(row.data), row.updated_at).then(function(choice){
            sync.userId = user.id;
            if(choice === 'cloud'){ applyRemote(row); return; }
            sync.rev = row.rev; // sobrescreve a nuvem com a versão deste aparelho
            return pushNow();
          });
        }
        if(!row){ sync.rev = 0; return pushNow(); }
        if(row.rev === sync.rev){ return sync.dirty ? pushNow() : undefined; }
        // A nuvem andou (outro aparelho). Vale a alteração mais recente.
        if(!sync.dirty || new Date(row.updated_at).getTime() >= sync.localUpdatedAt){ applyRemote(row); return; }
        sync.rev = row.rev;
        return pushNow();
      }).catch(function(err){
        if(err && err.conflict && attempts < 3) return run();
        throw err;
      });
    }
    inflight = run().then(function(){ return 'synced'; }).finally(function(){ inflight = null; });
    return inflight;
  }

  /* ---------- INICIALIZAÇÃO ---------- */
  var readyResolve;
  var ready = new Promise(function(r){ readyResolve = r; });

  function onUser(u){
    var changed = (u && u.id) !== (user && user.id);
    user = u || null;
    if(!user){ readyResolve(); emit(); return; }
    if(plan && plan.userId !== user.id) plan = null;
    if(changed) emit();
    refreshPlan().then(function(){ readyResolve(); return syncNow(); }).catch(function(){ readyResolve(); });
  }

  if(client){
    client.auth.onAuthStateChange(function(event, session){
      // callbacks do supabase-js não devem chamar a API de forma síncrona
      setTimeout(function(){
        if(event === 'PASSWORD_RECOVERY' && app && app.onPasswordRecovery) app.onPasswordRecovery();
        onUser(session ? session.user : null);
      }, 0);
    });
    // com o app aberto, busca alterações de outros aparelhos de tempos em tempos
    setInterval(function(){
      if(user && isPremium() && document.visibilityState === 'visible') syncNow().catch(function(){});
    }, 60000);
    window.addEventListener('online', function(){ if(user) refreshPlan().then(function(){ return syncNow(); }).catch(function(){}); });
    document.addEventListener('visibilitychange', function(){
      if(!user) return;
      if(document.visibilityState === 'hidden'){
        if(sync.dirty && isPremium()) syncNow().catch(function(){});
      } else {
        refreshPlan().then(function(){ return syncNow(); }).catch(function(){});
      }
    });
  } else {
    readyResolve();
  }

  window.GymCloud = {
    enabled: enabled,
    ready: ready,
    attachApp: function(hooks){ app = hooks; if(user) syncNow().catch(function(){}); },
    onChange: function(fn){ listeners.push(fn); },
    getUser: function(){ return user; },
    getPlan: function(){ return plan && user && plan.userId === user.id ? plan : null; },
    isPremium: isPremium,
    trialAvailable: function(){ return !(plan && user && plan.userId === user.id && plan.trialUsed); },
    refreshPlan: refreshPlan,
    signUp: signUp, signIn: signIn, signOut: signOut,
    resetPassword: resetPassword, updatePassword: updatePassword,
    startCheckout: startCheckout, openPortal: openPortal, deleteAccount: deleteAccount,
    notifyLocalChange: notifyLocalChange,
    syncNow: syncNow,
    getSyncInfo: function(){ return { lastSyncAt: sync.lastSyncAt, dirty: sync.dirty, linked: !!user && sync.userId === user.id }; }
  };
})();
