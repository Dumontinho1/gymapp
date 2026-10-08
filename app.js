/* GymApp - offline-first workout tracker */
(function(){
  'use strict';

  var LS_WORKOUTS = 'gymapp:workouts';
  var LS_ATTEND = 'gymapp:attendance';
  var LS_PROFILE = 'gymapp:profile';
  var LS_THEME = 'gymapp:theme';
  var LS_LASTDAY = 'gymapp:lastDay';
  var LS_HISTORY = 'gymapp:history';
  var LS_PR = 'gymapp:prs';
  var LS_SESSIONS = 'gymapp:sessions';
  var LS_PRLOG = 'gymapp:prlog';
  var LS_NOTIF = 'gymapp:notifPref';
  var LS_LAST_EXPORT = 'gymapp:lastExport';
  var LS_ACCENT = 'gymapp:accent';
  var LS_ACCENT_COLORS = 'gymapp:accentColors'; // [a, b] — read by the inline <head> script to avoid a color flash
  var LS_BADGES = 'gymapp:badges';

  var DEFAULT_REST = 90;
  var SET_SECONDS = 45;      // assumed time under tension per set (calorie estimate)
  var WORKOUT_MET = 5;       // metabolic equivalent for moderate-vigorous weight training
  var DEFAULT_WEIGHT_KG = 70;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* Sanity limits — anything outside is treated as invalid input (typos,
     corrupted or hand-edited backups) instead of poisoning stats/records. */
  var MAX_LOAD = 2000;       // kg
  var MAX_REPS = 1000;
  var MAX_SETS = 50;
  var MAX_EXERCISES = 100;
  var MIN_REST = 10, MAX_REST = 600;
  var MIN_WEIGHT = 20, MAX_WEIGHT = 400;
  var MAX_IMPORT_BYTES = 5 * 1024 * 1024;

  var DAYS = [
    { idx:1, label:'Seg' }, { idx:2, label:'Ter' }, { idx:3, label:'Qua' },
    { idx:4, label:'Qui' }, { idx:5, label:'Sex' }, { idx:6, label:'Sáb' },
    { idx:0, label:'Dom' }
  ];
  var MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var WEEKDAY_FULL = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

  function isObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
  function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }
  function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

  /* Parses a user-entered number (accepts "62,5"); returns NaN unless it is
     finite, > 0 and <= max. Used everywhere loads/reps are read so negative,
     absurd or non-numeric values can't corrupt volume, PRs or charts. */
  function num(v, max){
    var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return (isFinite(n) && n > 0 && n <= max) ? n : NaN;
  }

  /* Strict "YYYY-MM-DD" check that also rejects impossible dates (2026-02-31). */
  function isValidDateKey(s){
    if(typeof s !== 'string' || !DATE_RE.test(s)) return false;
    var d = new Date(s + 'T00:00:00');
    return !isNaN(d.getTime()) && todayKey(d) === s;
  }

  function loadJSON(key, fallback){
    try{
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    }catch(e){ return fallback; }
  }
  var autosaveTimer = null;
  function flashAutosave(){
    var el = document.getElementById('autosaveBadge');
    if(!el) return;
    el.classList.add('show');
    if(autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function(){ el.classList.remove('show'); }, 1100);
  }
  var saveErrorShown = false;
  function saveJSON(key, val){
    try{
      localStorage.setItem(key, JSON.stringify(val));
      flashAutosave();
      return true;
    }catch(e){
      if(!saveErrorShown){
        saveErrorShown = true;
        showToast('⚠ Não foi possível salvar — armazenamento cheio ou bloqueado. Exporte um backup!', 'error');
        setTimeout(function(){ saveErrorShown = false; }, 10000);
      }
      return false;
    }
  }
  function pad2(n){ return n<10 ? '0'+n : ''+n; }
  function todayKey(d){
    d = d || new Date();
    return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  }
  function uid(){ return 'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

  /* ---------- STATE ---------- */
  var workouts = loadJSON(LS_WORKOUTS, {});   // { "1": {name:"", exercises:[{id,name,sets:[{reps,load}]}]}, ... }
  var attendance = loadJSON(LS_ATTEND, {});   // { "2026-09-15": true }
  var profile = loadJSON(LS_PROFILE, { name:'', height:'', weightHistory:[] });
  var theme = loadJSON(LS_THEME, 'dark');
  var selectedDay = loadJSON(LS_LASTDAY, new Date().getDay());
  var calViewDate = new Date();
  var history = loadJSON(LS_HISTORY, {}); // { "supino reto": { date:"2026-09-10", sets:[{reps,load}] } }
  var prs = loadJSON(LS_PR, {}); // { "supino reto": { load:60, reps:"8", date:"2026-09-10" } }
  var sessions = loadJSON(LS_SESSIONS, []); // [{ date, dayIdx, exercises:[{name, sets:[{reps,load}]}], undo }]
  var prlog = loadJSON(LS_PRLOG, []); // [{ name, load, date }] — appended each time a PR is broken
  var notifPref = loadJSON(LS_NOTIF, false);
  var accentId = loadJSON(LS_ACCENT, 'violet');
  var badges = loadJSON(LS_BADGES, {}); // { badgeId: "2026-09-15" } — unlock date

  /* Guard against corrupted / wrong-typed data in localStorage */
  if(!isObj(badges)) badges = {};
  if(typeof accentId !== 'string') accentId = 'violet';
  if(!isObj(workouts)) workouts = {};
  if(!isObj(attendance)) attendance = {};
  if(!isObj(profile)) profile = { name:'', height:'', weightHistory:[] };
  if(!Array.isArray(profile.weightHistory)) profile.weightHistory = [];
  if(!isObj(history)) history = {};
  if(!isObj(prs)) prs = {};
  if(!Array.isArray(sessions)) sessions = [];
  if(!Array.isArray(prlog)) prlog = [];
  if(typeof selectedDay !== 'number' || selectedDay < 0 || selectedDay > 6) selectedDay = new Date().getDay();

  function getDayData(idx){
    if(!workouts[idx]) workouts[idx] = { name:'', exercises:[] };
    return workouts[idx];
  }

  /* Lookup key for an exercise name. Names like "constructor" or "__proto__"
     would collide with Object.prototype members when used as plain-object keys
     (prs["constructor"] would be a function), so they get a suffix. */
  function historyKey(name){
    var k = (name || '').trim().toLowerCase();
    return (k in Object.prototype) ? k + ' ' : k;
  }

  function persistHistory(){ saveJSON(LS_HISTORY, history); }
  function persistSessions(){ saveJSON(LS_SESSIONS, sessions); }
  function persistPRs(){ saveJSON(LS_PR, prs); }
  function persistPRLog(){ saveJSON(LS_PRLOG, prlog); }
  function persistAttendance(){ saveJSON(LS_ATTEND, attendance); }
  function persistBadges(){ saveJSON(LS_BADGES, badges); }

  /* Workout edits fire on every keystroke; the localStorage write is debounced
     and always flushed when the page is hidden/closed so nothing is lost. */
  var workoutsSaveTimer = null;
  function flushWorkouts(){
    if(workoutsSaveTimer){ clearTimeout(workoutsSaveTimer); workoutsSaveTimer = null; }
    saveJSON(LS_WORKOUTS, workouts);
  }
  function persistWorkouts(){
    if(workoutsSaveTimer) clearTimeout(workoutsSaveTimer);
    workoutsSaveTimer = setTimeout(flushWorkouts, 300);
    scheduleResync();
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden' && workoutsSaveTimer) flushWorkouts();
  });
  window.addEventListener('pagehide', function(){ if(workoutsSaveTimer) flushWorkouts(); });

  /* Snapshot of everything a completed session touches, so unmarking a day
     (and its undo) can restore the exact previous state. */
  function captureState(){
    return {
      attendance: deepCopy(attendance), history: deepCopy(history),
      prs: deepCopy(prs), sessions: deepCopy(sessions), prlog: deepCopy(prlog)
    };
  }
  function cancelResync(){
    if(resyncTimer){ clearTimeout(resyncTimer); resyncTimer = null; }
  }
  function restoreState(s){
    cancelResync(); // a pending resync would otherwise overwrite the restored sessions
    attendance = s.attendance; history = s.history; prs = s.prs;
    sessions = s.sessions; prlog = s.prlog;
    persistAttendance(); persistHistory(); persistPRs(); persistSessions(); persistPRLog();
  }

  /* Heaviest filled set of a list of sets, or null. */
  function bestSet(sets){
    var best = null;
    sets.forEach(function(s){
      var l = num(s.load, MAX_LOAD);
      if(isNaN(l)) return;
      if(!best || l > best.load) best = { load: l, reps: s.reps || '' };
    });
    return best;
  }

  /* Records the day's filled-in sets as a session: updates the "última vez"
     reference per exercise, the session list (for the Progress tab) and the
     personal records. A PR counts only when the session's heaviest set beats
     the record from previously completed sessions — at most once per exercise
     per session. Returns the list of broken records (first-ever entries don't
     count). Everything that was changed is remembered in session.undo so
     revertSession() can roll it back. */
  function snapshotHistoryForDay(dayIdx, dateKey){
    var data = getDayData(dayIdx);
    var k = dateKey || todayKey();
    var sessionExercises = [];
    var undo = { history:{}, prs:{}, prlogKeys:[] };
    var broken = [];

    data.exercises.forEach(function(ex){
      var name = (ex.name || '').trim();
      if(!name) return;
      var filledSets = ex.sets.filter(function(s){ return s.reps || s.load; });
      if(filledSets.length === 0) return;
      var setsCopy = filledSets.map(function(s){ return { reps: s.reps, load: s.load }; });
      var key = historyKey(name);

      if(!(key in undo.history)) undo.history[key] = history[key] || null;
      history[key] = { date: k, sets: setsCopy };
      sessionExercises.push({ name: name, sets: setsCopy, rest: ex.restSeconds || DEFAULT_REST });

      var best = bestSet(setsCopy);
      if(best){
        var cur = prs[key];
        if(!cur || best.load > cur.load){
          if(!(key in undo.prs)) undo.prs[key] = cur || null;
          prs[key] = { load: best.load, reps: best.reps, date: k };
          if(cur){
            prlog.push({ name: name, load: best.load, date: k });
            undo.prlogKeys.push(key);
            broken.push({ name: name, load: best.load });
          }
        }
      }
    });

    persistHistory(); persistPRs(); persistPRLog();

    if(sessionExercises.length){
      var record = { date: k, dayIdx: dayIdx, exercises: sessionExercises, undo: undo };
      var existingIdx = sessions.findIndex(function(s){ return s.date === k; });
      if(existingIdx > -1) sessions[existingIdx] = record; else sessions.push(record);
      persistSessions();
    }
    return broken;
  }

  /* Removes the session logged on a date and rolls back the history/PR changes
     it made (only where nothing newer has overwritten them since). */
  function revertSession(k){
    var idx = sessions.findIndex(function(s){ return s.date === k; });
    if(idx < 0) return;
    var u = sessions[idx].undo;
    if(isObj(u)){
      Object.keys(u.history || {}).forEach(function(key){
        if(history[key] && history[key].date === k){
          if(u.history[key]) history[key] = u.history[key]; else delete history[key];
        }
      });
      Object.keys(u.prs || {}).forEach(function(key){
        if(prs[key] && prs[key].date === k){
          if(u.prs[key]) prs[key] = u.prs[key]; else delete prs[key];
        }
      });
      if(Array.isArray(u.prlogKeys) && u.prlogKeys.length){
        prlog = prlog.filter(function(e){
          return !(e.date === k && u.prlogKeys.indexOf(historyKey(e.name)) > -1);
        });
      }
    }
    sessions.splice(idx, 1);
    persistHistory(); persistPRs(); persistPRLog(); persistSessions();
  }

  /* If you edit sets of a day that's already marked as done, keep its logged
     session in sync (debounced, silent). */
  var resyncTimer = null;
  function scheduleResync(){
    var dayIdx = selectedDay;
    var k = todayKey(mostRecentDateForWeekday(dayIdx));
    if(!attendance[k]) return;
    if(resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(function(){
      resyncTimer = null;
      if(!attendance[k]) return;
      var existing = sessions.find(function(s){ return s.date === k; });
      if(existing && existing.dayIdx !== dayIdx) return;
      revertSession(k);
      snapshotHistoryForDay(dayIdx, k);
    }, 800);
  }

  /* Total volume (reps x load, summed across all filled sets) of one logged session. */
  function sessionVolume(session){
    var total = 0;
    session.exercises.forEach(function(ex){
      ex.sets.forEach(function(s){
        var r = num(s.reps, MAX_REPS), l = num(s.load, MAX_LOAD);
        if(!isNaN(r) && !isNaN(l)) total += r * l;
      });
    });
    return total;
  }

  function formatDateShort(dateKey){
    if(typeof dateKey !== 'string') return '--/--';
    var parts = dateKey.split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] : '--/--';
  }

  /* ---------- TOAST (info / PR celebration / error / undo) ---------- */
  var toastEl = document.getElementById('toast');
  var toastMsgEl = document.getElementById('toastMsg');
  var toastUndoBtn = document.getElementById('toastUndoBtn');
  var toastTimer = null;
  var pendingUndo = null;

  function setToastKind(kind){
    toastEl.classList.remove('pr', 'error');
    if(kind) toastEl.classList.add(kind);
  }

  function showToast(msg, kind){
    if(!toastEl) return;
    pendingUndo = null;
    toastUndoBtn.hidden = true;
    setToastKind(kind);
    toastMsgEl.textContent = msg;
    toastEl.classList.add('show');
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, kind === 'error' ? 5000 : 2600);
  }

  /* Shows a toast with a "Desfazer" button; if tapped before it expires, undoFn() runs. */
  function showUndoToast(msg, undoFn){
    pendingUndo = undoFn;
    toastUndoBtn.hidden = false;
    setToastKind(null);
    toastMsgEl.textContent = msg;
    toastEl.classList.add('show');
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); pendingUndo = null; }, 6000);
  }

  toastUndoBtn.addEventListener('click', function(){
    if(pendingUndo) pendingUndo();
    pendingUndo = null;
    toastEl.classList.remove('show');
    if(toastTimer) clearTimeout(toastTimer);
  });

  function celebratePRs(broken){
    var msg = broken.length === 1
      ? '🏆 Novo recorde em ' + broken[0].name + ': ' + broken[0].load + 'kg!'
      : '🏆 ' + broken.length + ' novos recordes: ' + broken.map(function(b){ return b.name; }).join(', ');
    showToast(msg, 'pr');
    if(navigator.vibrate) navigator.vibrate([80,40,80]);
  }

  /* ---------- ACCENT COLOR ---------- */
  var ACCENTS = [
    { id:'violet', label:'Roxo',     a:'#8b5cf6', b:'#06b6d4' },
    { id:'blue',   label:'Azul',     a:'#3b82f6', b:'#22d3ee' },
    { id:'green',  label:'Verde',    a:'#22c55e', b:'#a3e635' },
    { id:'orange', label:'Laranja',  a:'#f97316', b:'#f43f5e' },
    { id:'pink',   label:'Rosa',     a:'#ec4899', b:'#8b5cf6' },
    { id:'red',    label:'Vermelho', a:'#ef4444', b:'#f59e0b' }
  ];

  function applyAccent(){
    var c = ACCENTS.find(function(x){ return x.id === accentId; }) || ACCENTS[0];
    var root = document.documentElement.style;
    root.setProperty('--accent', c.a);
    root.setProperty('--accent-2', c.b);
    root.setProperty('--accent-grad', 'linear-gradient(135deg,' + c.a + ',' + c.b + ')');
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', c.a);
    try{ localStorage.setItem(LS_ACCENT_COLORS, JSON.stringify([c.a, c.b])); }catch(e){}
  }

  function renderAccentPicker(){
    var wrap = document.getElementById('accentPicker');
    if(!wrap) return;
    wrap.innerHTML = '';
    ACCENTS.forEach(function(c){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'accent-swatch' + (c.id === accentId ? ' active' : '');
      btn.style.background = 'linear-gradient(135deg,' + c.a + ',' + c.b + ')';
      btn.title = c.label;
      btn.setAttribute('aria-label', 'Cor ' + c.label);
      btn.addEventListener('click', function(){
        accentId = c.id;
        saveJSON(LS_ACCENT, accentId);
        applyAccent();
        renderAccentPicker();
      });
      wrap.appendChild(btn);
    });
  }

  /* ---------- STATS shared by badges / calories ---------- */
  function daysBetween(a, b){
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function computeStats(){
    var keys = Object.keys(attendance).filter(function(k){ return attendance[k] && isValidDateKey(k); });
    var perMonth = {}, perWeek = {};
    keys.forEach(function(k){
      var mk = k.slice(0, 7);
      perMonth[mk] = (perMonth[mk] || 0) + 1;
      var wk = todayKey(startOfWeek(new Date(k + 'T00:00:00')));
      perWeek[wk] = (perWeek[wk] || 0) + 1;
    });
    var bestMonth = 0;
    Object.keys(perMonth).forEach(function(m){ if(perMonth[m] > bestMonth) bestMonth = perMonth[m]; });

    // longest run of consecutive weeks with at least 3 trainings
    var activeWeeks = Object.keys(perWeek).filter(function(w){ return perWeek[w] >= 3; }).sort();
    var weekStreak = 0, run = 0;
    activeWeeks.forEach(function(w, i){
      run = (i > 0 && daysBetween(activeWeeks[i-1], w) === 7) ? run + 1 : 1;
      if(run > weekStreak) weekStreak = run;
    });

    var maxSessionVol = 0, totalVol = 0, names = {};
    sessions.forEach(function(s){
      var v = sessionVolume(s);
      totalVol += v;
      if(v > maxSessionVol) maxSessionVol = v;
      s.exercises.forEach(function(ex){ names[historyKey(ex.name)] = true; });
    });

    return {
      total: keys.length, bestMonth: bestMonth, weekStreak: weekStreak,
      prCount: prlog.length, maxSessionVol: maxSessionVol, totalVol: totalVol,
      distinct: Object.keys(names).length
    };
  }

  /* ---------- BADGES (derived from existing data; once unlocked they stay) ---------- */
  var BADGE_DEFS = [
    { id:'first', icon:'🎯', title:'Primeiro treino',  desc:'Conclua 1 treino',                       prog:function(s){ return [s.total, 1]; } },
    { id:'t10',   icon:'🔟', title:'Pegando ritmo',    desc:'Conclua 10 treinos',                     prog:function(s){ return [s.total, 10]; } },
    { id:'t50',   icon:'💪', title:'Frequentador',     desc:'Conclua 50 treinos',                     prog:function(s){ return [s.total, 50]; } },
    { id:'t100',  icon:'💯', title:'Centenário',       desc:'Conclua 100 treinos',                    prog:function(s){ return [s.total, 100]; } },
    { id:'m10',   icon:'📅', title:'Mês de ferro',     desc:'Treine 10x no mesmo mês',                prog:function(s){ return [s.bestMonth, 10]; } },
    { id:'w4',    icon:'🔥', title:'Constância',       desc:'4 semanas seguidas com 3+ treinos',      prog:function(s){ return [s.weekStreak, 4]; } },
    { id:'pr1',   icon:'🏆', title:'Primeiro recorde', desc:'Bata 1 recorde pessoal',                 prog:function(s){ return [s.prCount, 1]; } },
    { id:'pr10',  icon:'🥇', title:'Quebra-recordes',  desc:'Bata 10 recordes pessoais',              prog:function(s){ return [s.prCount, 10]; } },
    { id:'ton',   icon:'🏋️', title:'Tonelada',         desc:'1.000 kg de volume em um treino',        prog:function(s){ return [s.maxSessionVol, 1000]; } },
    { id:'vol50', icon:'🚛', title:'50 toneladas',     desc:'50.000 kg de volume total',              prog:function(s){ return [s.totalVol, 50000]; } },
    { id:'var10', icon:'🧩', title:'Variado',          desc:'Treine 10 exercícios diferentes',        prog:function(s){ return [s.distinct, 10]; } }
  ];

  /* Unlocks any newly earned badges and returns them. Called silently on
     startup (backfills history without toasts) and with a toast after
     marking a workout. */
  function evaluateBadges(precomputedStats){
    var stats = precomputedStats || computeStats();
    var fresh = [];
    BADGE_DEFS.forEach(function(d){
      if(badges[d.id]) return;
      var p = d.prog(stats);
      if(p[0] >= p[1]){ badges[d.id] = todayKey(); fresh.push(d); }
    });
    if(fresh.length) persistBadges();
    return fresh;
  }

  function celebrateBadges(list){
    var msg = list.length === 1
      ? '🏅 Conquista: ' + list[0].title + '!'
      : '🏅 ' + list.length + ' conquistas: ' + list.map(function(b){ return b.title; }).join(', ');
    showToast(msg, 'pr');
  }

  function formatCount(n){ return isFinite(n) ? Math.floor(n).toLocaleString('pt-BR') : '0'; }

  function renderBadges(){
    var stats = computeStats(); // computed once and shared with evaluateBadges
    evaluateBadges(stats);
    var grid = document.getElementById('badgeGrid');
    grid.innerHTML = '';
    var unlocked = 0;
    BADGE_DEFS.forEach(function(d){
      var done = !!badges[d.id];
      if(done) unlocked++;
      var p = d.prog(stats);
      var item = document.createElement('div');
      item.className = 'badge-item' + (done ? ' unlocked' : '');
      item.innerHTML = '<div class="badge-icon"></div><div class="badge-title"></div><div class="badge-desc"></div><div class="badge-prog"></div>';
      item.querySelector('.badge-icon').textContent = d.icon;
      item.querySelector('.badge-title').textContent = d.title;
      item.querySelector('.badge-desc').textContent = d.desc;
      item.querySelector('.badge-prog').textContent = done
        ? 'Desbloqueada em ' + formatDateShort(badges[d.id])
        : formatCount(Math.min(p[0], p[1])) + ' / ' + formatCount(p[1]);
      grid.appendChild(item);
    });
    document.getElementById('badgeCount').textContent = unlocked + ' / ' + BADGE_DEFS.length;
  }

  /* ---------- CALORIE ESTIMATE ---------- */
  /* Weight registered on (or most recently before) the given date; falls back
     to the earliest registered weight, then null. */
  function weightAt(dateKey){
    var h = profile.weightHistory || [];
    var best = null;
    h.forEach(function(w){ if(w.date <= dateKey) best = w; });
    if(!best && h.length) best = h[0];
    var kg = best ? parseFloat(best.weight) : NaN;
    return (isNaN(kg) || kg <= 0) ? null : kg;
  }

  /* kcal ≈ MET × weight(kg) × hours. Duration is inferred from the logged sets
     (time under tension + that exercise's rest), since sessions have no timer. */
  function estimateSessionKcal(s){
    var secs = 0;
    s.exercises.forEach(function(ex){
      var rest = ex.rest || DEFAULT_REST;
      secs += ex.sets.length * (SET_SECONDS + rest);
    });
    var kg = weightAt(s.date) || DEFAULT_WEIGHT_KG;
    return WORKOUT_MET * kg * (secs / 3600);
  }

  function renderKcal(){
    var now = new Date();
    var thisMonthKey = monthKey(now);
    var weekAgoKey = todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    var todayStr = todayKey(now);
    var month = 0, week = 0, count = 0, totalAll = 0;
    sessions.forEach(function(s){
      var k = estimateSessionKcal(s);
      totalAll += k; count++;
      if(s.date.slice(0, 7) === thisMonthKey) month += k;
      if(s.date >= weekAgoKey && s.date <= todayStr) week += k;
    });
    document.getElementById('kcalMonth').textContent = formatCount(month) + ' kcal';
    document.getElementById('kcalWeek').textContent = formatCount(week) + ' kcal';
    document.getElementById('kcalAvg').textContent = count ? formatCount(totalAll / count) + ' kcal' : '–';
    document.getElementById('kcalHint').textContent = weightAt(todayStr) == null
      ? 'Usando ' + DEFAULT_WEIGHT_KG + ' kg — informe seu peso no Perfil para uma estimativa melhor. Valor aproximado.'
      : 'Estimativa aproximada: ~' + SET_SECONDS + 's por série + descanso, intensidade moderada. Não substitui medição real.';
  }

  /* ---------- YEAR HEATMAP (last 53 weeks, Monday-first columns) ---------- */
  function renderHeatmap(){
    var COLS = 53;
    var wrap = document.getElementById('heatmap');
    var labels = document.getElementById('heatmapMonths');
    wrap.innerHTML = '';
    labels.innerHTML = '';

    var thisMonday = startOfWeek(new Date());
    var vols = {}, maxVol = 1;
    sessions.forEach(function(s){
      vols[s.date] = sessionVolume(s);
      if(vols[s.date] > maxVol) maxVol = vols[s.date];
    });
    var todayStr = todayKey();
    var total = 0;

    for(var c = 0; c < COLS; c++){
      var monday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - (COLS - 1 - c) * 7);
      if(monday.getDate() <= 7){
        var lab = document.createElement('span');
        lab.textContent = MONTHS[monday.getMonth()].slice(0, 3);
        // never span past the last column, or the grid grows implicit columns and misaligns
        lab.style.gridColumn = (c + 1) + ' / span ' + Math.min(3, COLS - c);
        labels.appendChild(lab);
      }
      for(var r = 0; r < 7; r++){
        var day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + r);
        var key = todayKey(day);
        var cell = document.createElement('div');
        var cls = 'hm';
        if(key > todayStr){
          cls += ' future';
        } else if(attendance[key]){
          total++;
          var v = vols[key];
          var lvl = v ? Math.min(4, Math.max(1, Math.ceil(v / maxVol * 4))) : 1;
          cls += ' hm-' + lvl;
          cell.title = pad2(day.getDate()) + '/' + pad2(day.getMonth() + 1) + (v ? ' · ' + formatCount(v) + ' kg' : ' · treino concluído');
        } else {
          cls += ' hm-0';
        }
        if(key === todayStr) cls += ' hm-today';
        cell.className = cls;
        wrap.appendChild(cell);
      }
    }
    document.getElementById('heatmapCount').textContent = total + (total === 1 ? ' treino' : ' treinos') + ' em 12 meses';
  }

  /* ---------- GENERIC CONFIRM MODAL (used by every delete/overwrite action) ---------- */
  var confirmBackdrop = document.getElementById('confirmModalBackdrop');
  var confirmTitleEl = document.getElementById('confirmModalTitle');
  var confirmMsgEl = document.getElementById('confirmModalMsg');
  var confirmOkBtn = document.getElementById('confirmModalOk');
  var confirmCancelBtn = document.getElementById('confirmModalCancel');
  var confirmResolver = null;

  var confirmReturnFocus = null;

  function askConfirm(title, message, okLabel){
    if(confirmResolver){ confirmResolver(false); confirmResolver = null; } // never leave a caller awaiting forever
    confirmTitleEl.textContent = title;
    confirmMsgEl.textContent = message;
    confirmOkBtn.textContent = okLabel || 'Remover';
    if(!confirmBackdrop.classList.contains('open')) confirmReturnFocus = document.activeElement;
    confirmBackdrop.classList.add('open');
    confirmCancelBtn.focus(); // safe default for destructive prompts
    return new Promise(function(resolve){ confirmResolver = resolve; });
  }
  function closeConfirm(result){
    confirmBackdrop.classList.remove('open');
    if(confirmResolver){ confirmResolver(result); confirmResolver = null; }
    if(confirmReturnFocus && confirmReturnFocus.focus){ try{ confirmReturnFocus.focus(); }catch(e){} }
    confirmReturnFocus = null;
  }
  confirmOkBtn.addEventListener('click', function(){ closeConfirm(true); });
  confirmCancelBtn.addEventListener('click', function(){ closeConfirm(false); });
  confirmBackdrop.addEventListener('click', function(e){ if(e.target === confirmBackdrop) closeConfirm(false); });

  /* ---------- THEME ---------- */
  function applyTheme(){
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    var toggle = document.getElementById('darkModeToggle');
    if(toggle) toggle.checked = theme !== 'light';
  }

  /* ---------- NAV ---------- */
  function switchView(name){
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
    document.getElementById('view-'+name).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.view === name);
    });
    if(name === 'profile') renderProfile();
    if(name === 'progress') renderProgress();
  }

  /* ---------- HOME: TODAY STRIP ---------- */
  function renderTodayStrip(){
    var now = new Date();
    document.getElementById('todayLabel').textContent = WEEKDAY_FULL[now.getDay()];
    document.getElementById('todayDate').textContent = pad2(now.getDate())+' de '+MONTHS[now.getMonth()]+' de '+now.getFullYear();
    renderCheckButton();
  }

  /* The most recent real calendar date that falls on the given weekday (0-6) —
     "today" if it matches, otherwise the closest day within the last week.
     Lets marking a day tab as done log the date you actually trained, even
     when you open the tab a day or two later (e.g. logging Tuesday's session
     on Wednesday). */
  function mostRecentDateForWeekday(weekday){
    var now = new Date();
    var diff = (now.getDay() - weekday + 7) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  }

  function renderCheckButton(){
    var targetDate = mostRecentDateForWeekday(selectedDay);
    var key = todayKey(targetDate);
    var isRealToday = selectedDay === new Date().getDay();
    var done = !!attendance[key];
    var btn = document.getElementById('btnCheckToday');
    btn.classList.toggle('done', done);
    var dateLabel = pad2(targetDate.getDate()) + '/' + pad2(targetDate.getMonth()+1);
    var label;
    if(isRealToday) label = done ? 'Treino concluído hoje' : 'Marcar treino de hoje';
    else label = (done ? 'Concluído — ' : 'Marcar ') + WEEKDAY_FULL[selectedDay] + ' (' + dateLabel + ')';
    document.getElementById('checkTodayLabel').textContent = label;
  }

  /* ---------- DAY TABS ---------- */
  function renderDayTabs(){
    var wrap = document.getElementById('dayTabs');
    wrap.innerHTML = '';
    var todayIdx = new Date().getDay();
    DAYS.forEach(function(d){
      var el = document.createElement('button');
      el.type = 'button';
      var hasEx = getDayData(d.idx).exercises.length > 0;
      el.className = 'day-tab'
        + (d.idx === selectedDay ? ' active' : '')
        + (d.idx === todayIdx ? ' is-today' : '')
        + (hasEx ? ' has-exercises' : '');
      el.setAttribute('aria-pressed', d.idx === selectedDay ? 'true' : 'false');
      el.innerHTML = '<div class="dlabel">'+d.label+'</div><div class="ddot"></div>';
      el.addEventListener('click', function(){ selectDay(d.idx); });
      wrap.appendChild(el);
    });
  }

  function selectDay(idx){
    selectedDay = idx;
    saveJSON(LS_LASTDAY, selectedDay);
    renderDayTabs();
    renderDayPanel();
    renderCheckButton();
  }

  /* Next weekday (after `fromIdx`, wrapping the week) that has exercises. */
  function findNextTrainingDay(fromIdx){
    for(var step = 1; step <= 6; step++){
      var idx = (fromIdx + step) % 7;
      if(getDayData(idx).exercises.length > 0) return idx;
    }
    return null;
  }

  function buildRestDayCard(){
    var box = document.createElement('div');
    box.className = 'rest-day';
    var isToday = selectedDay === new Date().getDay();
    box.innerHTML = '<div class="rest-day-emoji">😴</div><div class="rest-day-title"></div><div class="rest-day-sub"></div>';
    box.querySelector('.rest-day-title').textContent = isToday ? 'Hoje é dia de descanso' : 'Dia de descanso';
    box.querySelector('.rest-day-sub').textContent = 'Nenhum treino cadastrado para ' + WEEKDAY_FULL[selectedDay] + '. Recupere bem — o músculo cresce no descanso.';
    var next = findNextTrainingDay(selectedDay);
    if(next != null){
      var nd = getDayData(next);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rest-day-next';
      btn.textContent = 'Próximo treino: ' + WEEKDAY_FULL[next] + (nd.name ? ' — ' + nd.name : '') + ' →';
      btn.addEventListener('click', function(){ selectDay(next); });
      box.appendChild(btn);
    }
    return box;
  }

  /* ---------- DAY PANEL / EXERCISES ---------- */
  function renderDayPanel(){
    var data = getDayData(selectedDay);
    var nameInput = document.getElementById('dayNameInput');
    nameInput.value = data.name || '';

    var list = document.getElementById('exerciseList');
    list.innerHTML = '';
    if(data.exercises.length === 0){
      var anyWorkout = DAYS.some(function(d){ return getDayData(d.idx).exercises.length > 0; });
      if(anyWorkout) list.appendChild(buildRestDayCard());
      else list.innerHTML = '<div class="empty-state">Nenhum exercício ainda.<br>Toque em "Adicionar exercício" para começar.</div>';
    }
    data.exercises.forEach(function(ex){
      list.appendChild(buildExerciseCard(ex));
    });
  }

  function buildExerciseCard(ex){
    if(ex.restSeconds == null) ex.restSeconds = DEFAULT_REST;

    var card = document.createElement('div');
    card.className = 'exercise-card';
    card.dataset.exId = ex.id;

    var prEntry = prs[historyKey(ex.name)];

    var head = document.createElement('div');
    head.className = 'exercise-card-head';
    head.innerHTML = '<div class="exname-wrap">'
      + '<button class="drag-handle" title="Arrastar para reordenar" aria-label="Arrastar para reordenar">⠿</button>'
      + '<input type="text" class="exname-input" maxlength="40" title="Toque para renomear" aria-label="Nome do exercício">'
      + '</div>'
      + '<div class="exercise-actions">'
      + '<button class="icon-mini danger" data-act="del-ex" title="Remover exercício" aria-label="Remover exercício">🗑</button>'
      + '</div>';
    if(prEntry){
      // built with textContent (never innerHTML) — record data can come from imported files
      var prBadge = document.createElement('span');
      prBadge.className = 'pr-badge';
      prBadge.textContent = '🏆 ' + prEntry.load + 'kg';
      head.querySelector('.exname-wrap').appendChild(prBadge);
    }
    var exNameInput = head.querySelector('.exname-input');
    var lastGoodName = ex.name;
    exNameInput.value = ex.name;
    exNameInput.addEventListener('input', function(){
      ex.name = exNameInput.value;
      persistWorkouts();
    });
    exNameInput.addEventListener('change', function(){
      var trimmed = exNameInput.value.trim();
      if(!trimmed){
        ex.name = lastGoodName;
        exNameInput.value = lastGoodName;
        persistWorkouts();
        return;
      }
      ex.name = trimmed;
      lastGoodName = trimmed;
      persistWorkouts();
      var parent = card.parentElement;
      if(!parent) return;
      var fresh = buildExerciseCard(ex);
      parent.replaceChild(fresh, card);
      renderDayTabs();
    });
    card.appendChild(head);

    var lastEntry = history[historyKey(ex.name)];
    if(lastEntry && lastEntry.date !== todayKey()){
      var lastLine = document.createElement('div');
      lastLine.className = 'last-time';
      var summary = lastEntry.sets.map(function(s){
        return (s.reps || '-') + '×' + (s.load || '-') + 'kg';
      }).join(', ');
      // textContent only: set values may originate from an imported backup (XSS vector via innerHTML)
      var ltLabel = document.createElement('span');
      ltLabel.className = 'lt-label';
      ltLabel.textContent = 'Última vez (' + formatDateShort(lastEntry.date) + '):';
      lastLine.appendChild(ltLabel);
      lastLine.appendChild(document.createTextNode(summary));
      card.appendChild(lastLine);
    }

    var rows = document.createElement('div');
    rows.className = 'set-rows';
    ex.sets.forEach(function(s, i){
      rows.appendChild(buildSetRow(ex, s, i, prEntry));
    });
    card.appendChild(rows);

    var addSetBtn = document.createElement('button');
    addSetBtn.className = 'add-set-btn';
    addSetBtn.textContent = '+ Série';
    addSetBtn.addEventListener('click', function(){
      ex.sets.push({ reps:'', load:'' });
      persistWorkouts();
      renderDayPanel();
    });
    card.appendChild(addSetBtn);

    var restRow = document.createElement('div');
    restRow.className = 'exercise-rest-row';
    restRow.innerHTML = '<span class="rest-label">Descanso</span>'
      + '<input type="number" min="10" max="600" step="5" class="rest-secs-input">'
      + '<span class="unit">s</span>'
      + '<button class="btn-start-ex-rest">▶ Iniciar</button>';
    var restSecsInput = restRow.querySelector('.rest-secs-input');
    restSecsInput.value = ex.restSeconds;
    restSecsInput.addEventListener('input', function(){
      var v = parseInt(restSecsInput.value, 10);
      if(!isNaN(v) && v >= MIN_REST && v <= MAX_REST){ ex.restSeconds = v; persistWorkouts(); }
    });
    // out-of-range or empty values are corrected once typing is done (clamping per keystroke would block typing "120")
    restSecsInput.addEventListener('change', function(){
      var v = parseInt(restSecsInput.value, 10);
      ex.restSeconds = isNaN(v) ? (ex.restSeconds || DEFAULT_REST) : clamp(v, MIN_REST, MAX_REST);
      restSecsInput.value = ex.restSeconds;
      persistWorkouts();
    });
    restRow.querySelector('.btn-start-ex-rest').addEventListener('click', function(){
      startRestFor(ex.name, ex.restSeconds);
    });
    card.appendChild(restRow);

    head.querySelector('[data-act="del-ex"]').addEventListener('click', async function(){
      var ok = await askConfirm('Remover exercício', 'Remover "' + ex.name + '" e todas as suas séries deste dia? Essa ação pode ser desfeita logo em seguida.', 'Remover');
      if(!ok) return;
      var data = getDayData(selectedDay);
      var idx = data.exercises.indexOf(ex);
      if(idx === -1) return;
      data.exercises.splice(idx, 1);
      persistWorkouts();
      renderDayPanel();
      renderDayTabs();
      showUndoToast('Exercício "' + ex.name + '" removido', function(){
        data.exercises.splice(idx, 0, ex);
        persistWorkouts();
        renderDayPanel();
        renderDayTabs();
      });
    });

    attachDragHandlers(card, head.querySelector('.drag-handle'));

    return card;
  }

  /* ---------- DRAG TO REORDER (Pointer Events, works with mouse + touch) ---------- */
  function attachDragHandlers(card, handle){
    handle.addEventListener('pointerdown', function(e){
      e.preventDefault();
      var list = card.parentElement;
      var startY = e.clientY;
      card.classList.add('dragging');
      try{ handle.setPointerCapture(e.pointerId); }catch(err){}

      function onMove(ev){
        var delta = ev.clientY - startY;
        card.style.transform = 'translateY(' + delta + 'px)';

        var cardRect = card.getBoundingClientRect();
        var cardCenter = cardRect.top + cardRect.height / 2;
        var siblings = Array.from(list.children).filter(function(c){
          return c !== card && c.classList.contains('exercise-card');
        });
        for(var i=0;i<siblings.length;i++){
          var sib = siblings[i];
          var sibRect = sib.getBoundingClientRect();
          var sibCenter = sibRect.top + sibRect.height / 2;
          var pos = card.compareDocumentPosition(sib);
          var sibIsBeforeCard = !!(pos & Node.DOCUMENT_POSITION_PRECEDING);
          if(cardCenter < sibCenter && sibIsBeforeCard){
            list.insertBefore(card, sib);
            card.style.transform = 'translateY(0)';
            startY = ev.clientY;
            break;
          } else if(cardCenter > sibCenter && !sibIsBeforeCard){
            list.insertBefore(card, sib.nextSibling);
            card.style.transform = 'translateY(0)';
            startY = ev.clientY;
            break;
          }
        }
      }
      function onUp(ev){
        card.classList.remove('dragging');
        card.style.transform = '';
        try{ handle.releasePointerCapture(ev.pointerId); }catch(err){}
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);

        var newOrderIds = Array.from(list.children)
          .filter(function(c){ return c.classList.contains('exercise-card'); })
          .map(function(c){ return c.dataset.exId; });
        var data = getDayData(selectedDay);
        var oldOrder = data.exercises.map(function(x){ return x.id; }).join('|');
        data.exercises.sort(function(a, b){
          return newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id);
        });
        // only persist (and trigger a session resync) when the order actually changed
        if(data.exercises.map(function(x){ return x.id; }).join('|') !== oldOrder) persistWorkouts();
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  function buildSetRow(ex, s, i, prEntry){
    var row = document.createElement('div');
    row.className = 'set-row';
    var isPRSet = prEntry && num(s.load, MAX_LOAD) === prEntry.load;
    row.innerHTML =
      '<div class="setnum">'+(i+1)+'</div>'
      + '<div class="setfield"><input type="number" inputmode="numeric" min="0" max="' + MAX_REPS + '" placeholder="0" class="reps-input" aria-label="Repetições da série ' + (i+1) + '"><span class="unit">reps</span></div>'
      + '<div class="setfield' + (isPRSet ? ' pr-set' : '') + '"><input type="number" inputmode="decimal" min="0" max="' + MAX_LOAD + '" step="0.5" placeholder="0" class="load-input" aria-label="Carga da série ' + (i+1) + ' em kg"><span class="unit">kg</span>' + (isPRSet ? '<span class="pr-icon">🏆</span>' : '') + '</div>'
      + '<button class="copy-set" title="Copiar da série anterior / última vez" aria-label="Copiar da série anterior">⧉</button>'
      + '<button class="rm-set" title="Remover série" aria-label="Remover série ' + (i+1) + '">✕</button>';

    var repsInput = row.querySelector('.reps-input');
    var loadInput = row.querySelector('.load-input');
    repsInput.value = s.reps;
    loadInput.value = s.load;

    repsInput.addEventListener('input', function(){ s.reps = repsInput.value; persistWorkouts(); });
    loadInput.addEventListener('input', function(){ s.load = loadInput.value; persistWorkouts(); });

    /* One tap fills this set from the previous set of the same exercise; for
       the first set (or when the previous one is empty) it falls back to the
       matching set of the last logged session. */
    row.querySelector('.copy-set').addEventListener('click', function(){
      var src = null;
      var prev = i > 0 ? ex.sets[i-1] : null;
      if(prev && (prev.reps || prev.load)){
        src = prev;
      } else {
        var h = history[historyKey(ex.name)];
        if(h && h.sets && h.sets.length) src = h.sets[Math.min(i, h.sets.length - 1)];
      }
      if(!src || !(src.reps || src.load)){ showToast('Nada para copiar ainda'); return; }
      s.reps = src.reps; s.load = src.load;
      repsInput.value = s.reps; loadInput.value = s.load;
      persistWorkouts();
    });

    row.querySelector('.rm-set').addEventListener('click', async function(){
      var ok = await askConfirm('Remover série', 'Remover a série ' + (i+1) + ' de "' + ex.name + '"?', 'Remover');
      if(!ok) return;
      var removed = ex.sets.splice(i,1)[0];
      persistWorkouts();
      renderDayPanel();
      showUndoToast('Série ' + (i+1) + ' removida', function(){
        ex.sets.splice(i, 0, removed);
        persistWorkouts();
        renderDayPanel();
      });
    });

    return row;
  }

  /* ---------- MODAL: ADD EXERCISE ---------- */
  var modalBackdrop = document.getElementById('modalBackdrop');
  function openModal(){
    document.getElementById('exNameInput').value = '';
    document.getElementById('exSetsInput').value = 3;
    modalBackdrop.classList.add('open');
    setTimeout(function(){ document.getElementById('exNameInput').focus(); }, 250);
  }
  function closeModal(){ modalBackdrop.classList.remove('open'); }

  document.getElementById('btnAddExercise').addEventListener('click', openModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', function(e){ if(e.target === modalBackdrop) closeModal(); });

  document.getElementById('modalSave').addEventListener('click', function(){
    var name = document.getElementById('exNameInput').value.trim();
    var setsCount = parseInt(document.getElementById('exSetsInput').value, 10) || 1;
    if(!name){ document.getElementById('exNameInput').focus(); return; }
    setsCount = Math.max(1, Math.min(12, setsCount));
    var sets = [];
    for(var i=0;i<setsCount;i++) sets.push({ reps:'', load:'' });
    var data = getDayData(selectedDay);
    data.exercises.push({ id: uid(), name: name, sets: sets });
    persistWorkouts();
    closeModal();
    renderDayPanel();
    renderDayTabs();
  });

  document.getElementById('dayNameInput').addEventListener('input', function(e){
    getDayData(selectedDay).name = e.target.value;
    persistWorkouts();
  });

  /* ---------- COPY WORKOUT TO ANOTHER DAY ---------- */
  var copyModalBackdrop = document.getElementById('copyModalBackdrop');
  function openCopyModal(){
    var listEl = document.getElementById('copyDayList');
    listEl.innerHTML = '';
    DAYS.filter(function(d){ return d.idx !== selectedDay; }).forEach(function(d){
      var target = getDayData(d.idx);
      var btn = document.createElement('button');
      btn.className = 'copy-day-btn';
      var fullLabel = WEEKDAY_FULL[d.idx];
      var meta = target.exercises.length
        ? target.exercises.length + ' exercício(s) — será substituído'
        : 'vazio';
      btn.innerHTML = '<span>' + fullLabel + '</span><span class="cd-meta">' + meta + '</span>';
      btn.addEventListener('click', async function(){
        if(target.exercises.length > 0){
          var ok = await askConfirm(
            'Substituir treino',
            'O treino de ' + fullLabel + ' já tem ' + target.exercises.length + ' exercício(s). Substituir pelo treino de ' + WEEKDAY_FULL[selectedDay] + '?',
            'Substituir'
          );
          if(!ok) return;
        }
        copyWorkoutTo(d.idx, fullLabel);
      });
      listEl.appendChild(btn);
    });
    copyModalBackdrop.classList.add('open');
  }
  function closeCopyModal(){ copyModalBackdrop.classList.remove('open'); }
  function copyWorkoutTo(targetIdx, targetLabel){
    var previous = workouts[targetIdx];
    var source = getDayData(selectedDay);
    workouts[targetIdx] = {
      name: source.name,
      exercises: source.exercises.map(function(ex){
        return {
          id: uid(),
          name: ex.name,
          restSeconds: ex.restSeconds || DEFAULT_REST,
          sets: ex.sets.map(function(s){ return { reps: s.reps, load: s.load }; })
        };
      })
    };
    persistWorkouts();
    closeCopyModal();
    renderDayTabs();
    if(targetIdx === selectedDay) renderDayPanel();
    showUndoToast('Treino copiado para ' + targetLabel, function(){
      if(previous) workouts[targetIdx] = previous; else delete workouts[targetIdx];
      persistWorkouts();
      renderDayTabs();
      if(targetIdx === selectedDay) renderDayPanel();
    });
  }
  document.getElementById('btnCopyDay').addEventListener('click', openCopyModal);
  document.getElementById('copyModalCancel').addEventListener('click', closeCopyModal);
  copyModalBackdrop.addEventListener('click', function(e){ if(e.target === copyModalBackdrop) closeCopyModal(); });

  /* ---------- TODAY CHECK BUTTON ---------- */
  function refreshAfterAttendanceChange(){
    persistAttendance();
    renderTodayStrip();
    renderDayTabs();
    renderDayPanel();
    if(document.getElementById('view-profile').classList.contains('active')) renderProfile();
  }
  document.getElementById('btnCheckToday').addEventListener('click', function(){
    var targetDate = mostRecentDateForWeekday(selectedDay);
    var k = todayKey(targetDate);
    if(attendance[k]){
      var backup = captureState();
      if(resyncTimer){ clearTimeout(resyncTimer); resyncTimer = null; }
      revertSession(k);
      delete attendance[k];
      refreshAfterAttendanceChange();
      showUndoToast('Treino desmarcado', function(){
        restoreState(backup);
        refreshAfterAttendanceChange();
      });
    } else {
      attendance[k] = true;
      var broken = snapshotHistoryForDay(selectedDay, k);
      var newBadges = evaluateBadges();
      refreshAfterAttendanceChange();
      if(broken.length) celebratePRs(broken);
      if(newBadges.length) setTimeout(function(){ celebrateBadges(newBadges); }, broken.length ? 2900 : 0);
    }
  });

  /* ---------- REST TIMER (variable duration, per-exercise or general) ---------- */
  var REST_TOTAL = DEFAULT_REST;
  var restRemaining = REST_TOTAL;
  var restRunning = false;
  var restInterval = null;
  var restEndAt = 0; // absolute timestamp (ms) the countdown ends — lets us recompute
                      // the true remaining time even if setInterval got throttled
                      // or fully paused while the app was minimized.
  var restLabel = 'Descanso geral';
  var RING_CIRC = 2 * Math.PI * 52;

  var ringFg = document.getElementById('ringFg');
  var restTimeEl = document.getElementById('restTime');
  var restToggleBtn = document.getElementById('btnRestToggle');
  var restToggleLabel = document.getElementById('btnRestToggleLabel');
  var restActiveLabelEl = document.getElementById('restActiveLabel');
  var restChipsEl = document.getElementById('restChips');
  var ringWrap = document.querySelector('.rest-ring-wrap');
  ringFg.style.strokeDasharray = RING_CIRC;

  function renderRestTimer(){
    var m = Math.floor(restRemaining/60), s = restRemaining%60;
    restTimeEl.textContent = pad2(m)+':'+pad2(s);
    var frac = restRemaining / REST_TOTAL;
    ringFg.style.strokeDashoffset = RING_CIRC * (1-frac);
    ringFg.classList.remove('warn','done');
    if(restRemaining <= 0) ringFg.classList.add('done');
    else if(restRemaining <= 15) ringFg.classList.add('warn');
    restToggleBtn.classList.toggle('running', restRunning);
    restToggleLabel.textContent = restRunning ? 'Pausar' : (restRemaining < REST_TOTAL && restRemaining > 0 ? 'Continuar' : 'Descanso');
    ringWrap.classList.toggle('pulse', restRemaining <= 10 && restRemaining > 0 && restRunning);
    restActiveLabelEl.textContent = restLabel;
    Array.from(restChipsEl.children).forEach(function(chip){
      chip.classList.toggle('active', parseInt(chip.dataset.secs, 10) === REST_TOTAL);
    });
  }

  function setRestDuration(secs, label){
    REST_TOTAL = secs;
    restLabel = label || ('Descanso geral (' + secs + 's)');
    restRemaining = secs;
    restRunning = false;
    stopRestInterval();
    releaseWakeLock();
    renderRestTimer();
  }

  function startRestFor(exerciseName, secs){
    unlockAudio();
    REST_TOTAL = secs;
    restLabel = 'Descanso — ' + exerciseName;
    restRemaining = secs;
    restEndAt = Date.now() + secs*1000;
    restRunning = true;
    startRestInterval();
    acquireWakeLock();
    renderRestTimer();
    document.getElementById('restTimer').scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  Array.from(restChipsEl.children).forEach(function(chip){
    chip.addEventListener('click', function(){
      if(restRunning) return;
      setRestDuration(parseInt(chip.dataset.secs, 10));
    });
  });

  /* Wake Lock: keep the screen on while resting so the countdown stays visible */
  var wakeLock = null;
  var wakeLockPending = false;
  async function acquireWakeLock(){
    // `pending` guards the async gap: two quick calls must not each take a lock (the first would leak)
    if(!('wakeLock' in navigator) || wakeLock || wakeLockPending) return;
    wakeLockPending = true;
    try{
      var lock = await navigator.wakeLock.request('screen');
      if(!restRunning){ lock.release().catch(function(){}); return; } // timer stopped while we were waiting
      wakeLock = lock;
      lock.addEventListener('release', function(){ if(wakeLock === lock) wakeLock = null; });
    }catch(e){ wakeLock = null; }
    finally{ wakeLockPending = false; }
  }
  function releaseWakeLock(){
    if(wakeLock){ wakeLock.release().catch(function(){}); wakeLock = null; }
  }

  /* The app can stay alive in memory across midnight, so when it comes back to
     the foreground re-render "today" — but only if the date actually changed. */
  var lastRenderedDay = todayKey();
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState !== 'visible') return;
    if(restRunning){
      if(!wakeLock) acquireWakeLock();
      tickRest(); // snap the display to the true elapsed time right away
    }
    var nowKey = todayKey();
    if(nowKey !== lastRenderedDay){
      lastRenderedDay = nowKey;
      renderTodayStrip();
      renderDayTabs();
    }
  });

  /* Audio: a single AudioContext reused for every beep. Mobile browsers start
     it suspended until a user gesture, so we resume it on any tap. */
  var audioCtx = null;
  function getAudioCtx(){
    if(!audioCtx){
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if(Ctor){ try{ audioCtx = new Ctor(); }catch(e){ audioCtx = null; } }
    }
    return audioCtx;
  }
  function unlockAudio(){
    var ctx = getAudioCtx();
    if(ctx && ctx.state === 'suspended') ctx.resume().catch(function(){});
  }
  document.addEventListener('pointerdown', unlockAudio, { passive:true });
  document.addEventListener('touchend', unlockAudio, { passive:true });

  function beep(){
    try{
      var ctx = getAudioCtx();
      if(ctx){
        if(ctx.state === 'suspended') ctx.resume().catch(function(){});
        [0, 0.18, 0.36].forEach(function(t){
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = 880;
          o.connect(g); g.connect(ctx.destination);
          var start = ctx.currentTime + t;
          g.gain.setValueAtTime(0.001, start);
          g.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
          o.start(start); o.stop(start + 0.18);
        });
      }
    }catch(e){}
    if(navigator.vibrate) navigator.vibrate([200,80,200,80,200]);
  }

  /* Best-effort alert while the app is minimized: shows a silent system
     notification via the Service Worker so you notice rest is over even if
     you're on another app. Only fires when the app is NOT visible (the beep
     already covers the foreground). Android Chrome keeps this reliable in the
     background; iOS Safari's PWA background limits mean it mostly fires once
     you reopen/foreground the app rather than while deeply minimized. */
  function notifyRestDone(label){
    if(!notifPref || !document.hidden) return;
    if(!('Notification' in window) || Notification.permission !== 'granted') return;
    if(!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function(reg){
      reg.showNotification('Descanso finalizado', {
        body: (label || 'Descanso') + ' — hora de voltar pro treino 💪',
        silent: true,
        tag: 'gymapp-rest',
        renotify: true,
        icon: 'icon-192.png'
      }).catch(function(){});
    });
  }

  function tickRest(){
    if(!restRunning) return;
    restRemaining = Math.max(0, Math.round((restEndAt - Date.now()) / 1000));
    if(restRemaining <= 0){
      restRemaining = 0;
      stopRestInterval();
      restRunning = false;
      releaseWakeLock();
      beep();
      notifyRestDone(restLabel);
    }
    renderRestTimer();
  }
  function startRestInterval(){
    stopRestInterval();
    restInterval = setInterval(tickRest, 1000);
  }
  function stopRestInterval(){
    if(restInterval){ clearInterval(restInterval); restInterval = null; }
  }
  function resetRestTimer(autoStart){
    stopRestInterval();
    restRemaining = REST_TOTAL;
    restRunning = false;
    releaseWakeLock();
    renderRestTimer();
    if(autoStart){ toggleRest(); }
  }
  function toggleRest(){
    unlockAudio();
    if(restRunning){
      restRunning = false;
      stopRestInterval();
      releaseWakeLock();
    } else {
      if(restRemaining <= 0) restRemaining = REST_TOTAL;
      restEndAt = Date.now() + restRemaining*1000;
      restRunning = true;
      startRestInterval();
      acquireWakeLock();
    }
    renderRestTimer();
  }

  restToggleBtn.addEventListener('click', toggleRest);
  document.getElementById('btnRestReset').addEventListener('click', function(){ resetRestTimer(false); });

  /* ---------- PROFILE ---------- */
  var profileNameEl = document.getElementById('profileName');
  var profileWeightEl = document.getElementById('profileWeight');
  var profileHeightEl = document.getElementById('profileHeight');

  function renderProfile(){
    profileNameEl.value = profile.name || '';
    profileHeightEl.value = profile.height || '';
    var hist = profile.weightHistory || [];
    profileWeightEl.value = hist.length ? hist[hist.length-1].weight : '';
    renderWeightTrend();
    renderBMI();
    renderStats();
    renderCalendar();
    renderHeatmap();
    renderAccentPicker();
    checkOfflineReady();
  }

  function renderBMI(){
    var badge = document.getElementById('bmiBadge');
    var hist = profile.weightHistory || [];
    var weight = hist.length ? parseFloat(hist[hist.length-1].weight) : NaN;
    var heightCm = parseFloat(profile.height);
    // hide the badge for implausible values instead of showing a nonsense BMI
    if(isNaN(weight) || isNaN(heightCm) || heightCm < 80 || heightCm > 260 || weight < MIN_WEIGHT || weight > MAX_WEIGHT){
      badge.hidden = true;
      return;
    }
    var heightM = heightCm / 100;
    var bmi = weight / (heightM * heightM);
    var cls, label;
    if(bmi < 18.5){ cls = 'under'; label = 'Abaixo do peso'; }
    else if(bmi < 25){ cls = 'normal'; label = 'Peso normal'; }
    else if(bmi < 30){ cls = 'over'; label = 'Sobrepeso'; }
    else { cls = 'obese'; label = 'Obesidade'; }
    badge.className = 'bmi-badge ' + cls;
    badge.hidden = false;
    document.getElementById('bmiValue').textContent = 'IMC ' + bmi.toFixed(1);
    document.getElementById('bmiLabel').textContent = label;
  }

  profileNameEl.addEventListener('input', function(){
    profile.name = profileNameEl.value;
    saveJSON(LS_PROFILE, profile);
  });
  profileHeightEl.addEventListener('input', function(){
    profile.height = profileHeightEl.value;
    saveJSON(LS_PROFILE, profile);
    renderBMI();
  });
  profileWeightEl.addEventListener('change', function(){
    var v = parseFloat(String(profileWeightEl.value).replace(',', '.'));
    if(isNaN(v) || v < MIN_WEIGHT || v > MAX_WEIGHT){
      showToast('Peso inválido — use um valor entre ' + MIN_WEIGHT + ' e ' + MAX_WEIGHT + ' kg', 'error');
      var hist = profile.weightHistory || [];
      profileWeightEl.value = hist.length ? hist[hist.length-1].weight : '';
      return;
    }
    v = Math.round(v * 10) / 10;
    if(!profile.weightHistory) profile.weightHistory = [];
    var last = profile.weightHistory[profile.weightHistory.length-1];
    if(last && last.date === todayKey()){
      last.weight = v;
    } else {
      profile.weightHistory.push({ date: todayKey(), weight: v });
    }
    saveJSON(LS_PROFILE, profile);
    renderWeightTrend();
    renderBMI();
  });

  function renderWeightTrend(){
    var box = document.getElementById('weightTrend');
    var icon = document.getElementById('trendIcon');
    var text = document.getElementById('trendText');
    var hist = profile.weightHistory || [];
    box.classList.remove('up','down','flat');
    if(hist.length < 2){
      icon.textContent = '–';
      text.textContent = hist.length === 1 ? 'Primeiro registro salvo' : 'Sem histórico ainda';
      box.classList.add('flat');
      return;
    }
    var current = hist[hist.length-1].weight;
    var prev = hist[hist.length-2].weight;
    var diff = +(current - prev).toFixed(1);
    if(Math.abs(diff) < 0.05){
      icon.textContent = '→';
      text.textContent = 'Peso estável em relação ao último registro';
      box.classList.add('flat');
    } else if(diff > 0){
      icon.textContent = '↑';
      text.textContent = 'Ganhou ' + Math.abs(diff) + ' kg desde o último registro';
      box.classList.add('up');
    } else {
      icon.textContent = '↓';
      text.textContent = 'Perdeu ' + Math.abs(diff) + ' kg desde o último registro';
      box.classList.add('down');
    }
  }

  function renderStats(){
    var now = new Date();
    var monthCount = 0, yearCount = 0;
    Object.keys(attendance).forEach(function(k){
      if(!attendance[k]) return;
      var parts = k.split('-');
      var y = parseInt(parts[0],10), m = parseInt(parts[1],10);
      if(y === now.getFullYear()){
        yearCount++;
        if(m === now.getMonth()+1) monthCount++;
      }
    });
    document.getElementById('statMonth').textContent = monthCount;
    document.getElementById('statYear').textContent = yearCount;
  }

  function renderCalendar(){
    var y = calViewDate.getFullYear(), m = calViewDate.getMonth();
    document.getElementById('calMonthLabel').textContent = MONTHS[m] + ' ' + y;
    var grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';
    var firstDow = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m+1, 0).getDate();
    var now = new Date();
    var todayStr = todayKey(now);

    for(var i=0;i<firstDow;i++){
      var pad = document.createElement('div');
      pad.className = 'cal-day pad';
      grid.appendChild(pad);
    }
    for(var d=1; d<=daysInMonth; d++){
      var cell = document.createElement('div');
      var dateObj = new Date(y, m, d);
      var key = todayKey(dateObj);
      var cls = ['cal-day'];
      if(key === todayStr) cls.push('today');
      if(attendance[key]) cls.push('done');
      if(dateObj > now && key !== todayStr) cls.push('future');
      cell.className = cls.join(' ');
      cell.textContent = d;
      grid.appendChild(cell);
    }
  }

  document.getElementById('calPrev').addEventListener('click', function(){
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth()-1, 1);
    renderCalendar();
  });
  document.getElementById('calNext').addEventListener('click', function(){
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth()+1, 1);
    renderCalendar();
  });

  /* ---------- PROGRESS TAB ---------- */
  function monthKey(dateObj){ return dateObj.getFullYear() + '-' + pad2(dateObj.getMonth()+1); }

  function renderProgress(){
    renderVolumeCompare();
    renderKcal();
    renderWeekBars();
    renderExercisePicker();
    renderPRRanking();
    renderBadges();
  }

  function renderVolumeCompare(){
    var now = new Date();
    var thisMonthKey = monthKey(now);
    var lastMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth()-1, 1));
    var thisVol = 0, lastVol = 0;
    sessions.forEach(function(s){
      var mk = s.date.slice(0,7);
      var vol = sessionVolume(s);
      if(mk === thisMonthKey) thisVol += vol;
      else if(mk === lastMonthKey) lastVol += vol;
    });
    document.getElementById('volThisMonth').textContent = Math.round(thisVol) + ' kg';
    document.getElementById('volLastMonth').textContent = Math.round(lastVol) + ' kg';
    var deltaEl = document.getElementById('volDelta');
    deltaEl.classList.remove('up','down','flat');
    if(lastVol === 0 && thisVol === 0){
      deltaEl.textContent = '–';
      deltaEl.classList.add('flat');
    } else if(lastVol === 0){
      deltaEl.textContent = 'novo';
      deltaEl.classList.add('up');
    } else {
      var pct = Math.round(((thisVol - lastVol) / lastVol) * 100);
      if(pct > 0){ deltaEl.textContent = '↑ ' + pct + '%'; deltaEl.classList.add('up'); }
      else if(pct < 0){ deltaEl.textContent = '↓ ' + Math.abs(pct) + '%'; deltaEl.classList.add('down'); }
      else { deltaEl.textContent = '= 0%'; deltaEl.classList.add('flat'); }
    }
  }

  function startOfWeek(d){
    var day = d.getDay();
    var diff = (day === 0 ? -6 : 1) - day;
    var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    monday.setHours(0,0,0,0);
    return monday;
  }

  function renderWeekBars(){
    var wrap = document.getElementById('weekBars');
    wrap.innerHTML = '';
    var thisMonday = startOfWeek(new Date());
    var weeks = [];
    for(var i=5;i>=0;i--){
      var monday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - i*7);
      var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      var vol = 0;
      sessions.forEach(function(s){
        var d = new Date(s.date + 'T00:00:00');
        if(d >= monday && d <= sunday) vol += sessionVolume(s);
      });
      weeks.push({ monday: monday, vol: vol });
    }
    var maxVol = Math.max.apply(null, weeks.map(function(w){ return w.vol; }).concat([1]));
    weeks.forEach(function(w){
      var col = document.createElement('div');
      col.className = 'week-bar-col' + (w.vol === 0 ? ' empty' : '');
      var bar = document.createElement('div');
      bar.className = 'week-bar';
      var heightPct = w.vol === 0 ? 4 : Math.max(6, Math.round((w.vol / maxVol) * 100));
      bar.style.height = heightPct + '%';
      bar.title = Math.round(w.vol) + ' kg';
      var label = document.createElement('div');
      label.className = 'week-bar-label';
      label.textContent = pad2(w.monday.getDate()) + '/' + pad2(w.monday.getMonth()+1);
      col.appendChild(bar);
      col.appendChild(label);
      wrap.appendChild(col);
    });
  }

  /* One entry per exercise, de-duplicated by the same key the data uses
     ("Supino" and "supino " are the same exercise); keeps the first spelling seen. */
  function collectExerciseNames(){
    var byKey = {};
    sessions.forEach(function(s){
      s.exercises.forEach(function(ex){
        var k = historyKey(ex.name);
        if(!(k in byKey)) byKey[k] = ex.name;
      });
    });
    return Object.keys(byKey).map(function(k){ return byKey[k]; })
      .sort(function(a,b){ return a.localeCompare(b, 'pt-BR'); });
  }

  function renderExercisePicker(){
    var picker = document.getElementById('exercisePicker');
    var names = collectExerciseNames();
    var prevValue = picker.value;
    picker.innerHTML = '';
    if(names.length === 0){
      picker.innerHTML = '<option value="">Sem dados</option>';
      picker.disabled = true;
      renderLoadChart(null);
      return;
    }
    picker.disabled = false;
    names.forEach(function(n){
      var opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      picker.appendChild(opt);
    });
    if(names.indexOf(prevValue) > -1) picker.value = prevValue;
    renderLoadChart(picker.value);
  }

  document.getElementById('exercisePicker').addEventListener('change', function(){
    renderLoadChart(this.value);
  });

  function renderLoadChart(exName){
    var wrap = document.getElementById('loadChartWrap');
    var emptyMsg = document.getElementById('loadChartEmpty');
    Array.from(wrap.querySelectorAll('svg')).forEach(function(s){ s.remove(); });
    if(!exName){ emptyMsg.hidden = false; return; }

    var key = historyKey(exName);
    var points = [];
    sessions.forEach(function(s){
      var ex = s.exercises.find(function(e){ return historyKey(e.name) === key; });
      if(!ex) return;
      var maxLoad = 0;
      ex.sets.forEach(function(st){
        var l = num(st.load, MAX_LOAD);
        if(!isNaN(l) && l > maxLoad) maxLoad = l;
      });
      if(maxLoad > 0) points.push({ date: s.date, load: maxLoad });
    });
    points.sort(function(a,b){ return a.date < b.date ? -1 : 1; });

    if(points.length < 2){
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;

    var W = 320, H = 160, padL = 34, padR = 12, padT = 14, padB = 26;
    var minLoad = Math.min.apply(null, points.map(function(p){ return p.load; }));
    var maxLoad = Math.max.apply(null, points.map(function(p){ return p.load; }));
    if(minLoad === maxLoad){ minLoad -= 5; maxLoad += 5; }
    var xStep = (W - padL - padR) / (points.length - 1);
    function xAt(i){ return padL + i * xStep; }
    function yAt(v){ return padT + (1 - (v - minLoad) / (maxLoad - minLoad)) * (H - padT - padB); }

    var pathD = points.map(function(p,i){ return (i===0?'M':'L') + xAt(i).toFixed(1) + ',' + yAt(p.load).toFixed(1); }).join(' ');

    var svgns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    [minLoad, maxLoad].forEach(function(v){
      var y = yAt(v);
      var line = document.createElementNS(svgns, 'line');
      line.setAttribute('x1', padL); line.setAttribute('x2', W-padR);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('style', 'stroke:var(--border); stroke-width:1;');
      svg.appendChild(line);
      var label = document.createElementNS(svgns, 'text');
      label.setAttribute('x', 2); label.setAttribute('y', y+4);
      label.setAttribute('style', 'font-size:9px; fill:var(--text-dim);');
      label.textContent = Math.round(v) + 'kg';
      svg.appendChild(label);
    });

    var path = document.createElementNS(svgns, 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('style', 'fill:none; stroke:var(--accent-2); stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round;');
    svg.appendChild(path);

    points.forEach(function(p, i){
      var isLast = i === points.length - 1;
      var circle = document.createElementNS(svgns, 'circle');
      circle.setAttribute('cx', xAt(i)); circle.setAttribute('cy', yAt(p.load));
      circle.setAttribute('r', isLast ? 4.5 : 3);
      circle.setAttribute('style', 'fill:' + (isLast ? 'var(--gold)' : 'var(--accent-2)') + ';');
      svg.appendChild(circle);

      if(i === 0 || isLast || points.length <= 5){
        var dLabel = document.createElementNS(svgns, 'text');
        dLabel.setAttribute('x', xAt(i));
        dLabel.setAttribute('y', H - 8);
        dLabel.setAttribute('style', 'font-size:9px; fill:var(--text-dim);');
        dLabel.setAttribute('text-anchor', i===0 ? 'start' : (isLast ? 'end' : 'middle'));
        dLabel.textContent = formatDateShort(p.date);
        svg.appendChild(dLabel);
      }
    });

    wrap.appendChild(svg);
  }

  function renderPRRanking(){
    var list = document.getElementById('prRankList');
    list.innerHTML = '';
    var counts = {};
    prlog.forEach(function(entry){
      var key = historyKey(entry.name);
      if(!counts[key]) counts[key] = { name: entry.name, count: 0 };
      counts[key].count++;
    });
    var ranked = Object.keys(counts).map(function(k){ return counts[k]; })
      .sort(function(a,b){ return b.count - a.count; }).slice(0,5);
    if(ranked.length === 0){
      list.innerHTML = '<div class="empty-state">Bata seu primeiro recorde pra aparecer aqui.</div>';
      return;
    }
    var medals = ['🥇','🥈','🥉'];
    ranked.forEach(function(r, i){
      var row = document.createElement('div');
      row.className = 'pr-rank-row';
      var currentPR = prs[historyKey(r.name)];
      row.innerHTML = '<span class="pr-rank-medal">' + (medals[i] || (i+1) + '.') + '</span>'
        + '<span class="pr-rank-name"></span>'
        + '<span class="pr-rank-meta">' + r.count + ' recorde(s) · atual <b>' + (currentPR ? currentPR.load + 'kg' : '-') + '</b></span>';
      row.querySelector('.pr-rank-name').textContent = r.name;
      list.appendChild(row);
    });
  }

  document.getElementById('darkModeToggle').addEventListener('change', function(e){
    theme = e.target.checked ? 'dark' : 'light';
    saveJSON(LS_THEME, theme);
    applyTheme();
  });

  var notifToggleEl = document.getElementById('notifToggle');
  notifToggleEl.checked = notifPref && 'Notification' in window && Notification.permission === 'granted';
  notifToggleEl.addEventListener('change', async function(e){
    if(e.target.checked){
      if(!('Notification' in window)){
        e.target.checked = false;
        showToast('Notificações não suportadas neste navegador');
        return;
      }
      var perm = await Notification.requestPermission();
      if(perm !== 'granted'){
        e.target.checked = false;
        showToast('Permissão de notificação negada');
        notifPref = false;
        saveJSON(LS_NOTIF, notifPref);
        return;
      }
    }
    notifPref = e.target.checked;
    saveJSON(LS_NOTIF, notifPref);
  });

  /* ---------- IMPORT / EXPORT (JSON) ---------- */
  document.getElementById('btnExportWorkouts').addEventListener('click', function(){
    var payload = {
      app: 'GymApp', type: 'full-backup', version: 2, exportedAt: todayKey(),
      workouts: workouts, profile: profile, attendance: attendance,
      history: history, prs: prs, sessions: sessions, prlog: prlog, badges: badges
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gymapp-backup-' + todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    saveJSON(LS_LAST_EXPORT, todayKey());
    showToast('Backup exportado');
  });

  document.getElementById('btnImportWorkouts').addEventListener('click', function(){
    document.getElementById('importFileInput').click();
  });

  /* Every sanitizer returns null when the value is the wrong shape, so a
     malformed backup (or corrupted localStorage) can never put the app into a
     state that crashes on render. Object keys that collide with
     Object.prototype members are dropped (prototype-pollution guard), strings
     are length-capped and numbers range-checked. */
  function str(v, max){
    var s = v == null ? '' : String(v);
    return max ? s.slice(0, max) : s;
  }
  function safeKeys(o){
    return Object.keys(o).filter(function(k){ return !(k in Object.prototype); });
  }
  function sanitizeSets(sets){
    return (Array.isArray(sets) ? sets : []).filter(isObj).slice(0, MAX_SETS).map(function(s){
      return { reps: str(s.reps, 12), load: str(s.load, 12) };
    });
  }
  function sanitizeWorkoutDay(day){
    var seen = Object.create(null);
    var exercises = (Array.isArray(day.exercises) ? day.exercises : []).filter(isObj).slice(0, MAX_EXERCISES).map(function(ex){
      var cand = typeof ex.id === 'string' ? ex.id.slice(0, 40) : '';
      var id = (cand && !seen[cand]) ? cand : uid(); // ids must be unique: drag-reorder maps cards by id
      seen[id] = true;
      var rest = parseInt(ex.restSeconds, 10);
      return {
        id: id,
        name: str(ex.name, 40).trim() || 'Exercício',
        restSeconds: isNaN(rest) ? DEFAULT_REST : clamp(rest, MIN_REST, MAX_REST),
        sets: sanitizeSets(ex.sets)
      };
    });
    return { name: str(day.name, 30), exercises: exercises };
  }
  function sanitizeWorkouts(w){
    if(!isObj(w)) return null;
    var out = {};
    DAYS.forEach(function(d){
      var k = String(d.idx);
      if(Object.prototype.hasOwnProperty.call(w, k) && isObj(w[k])) out[k] = sanitizeWorkoutDay(w[k]);
    });
    return out;
  }
  function sanitizeProfile(p){
    if(!isObj(p)) return null;
    var wh = (Array.isArray(p.weightHistory) ? p.weightHistory : []).filter(function(w){
      var kg = isObj(w) ? parseFloat(w.weight) : NaN;
      return isValidDateKey(w && w.date) && kg >= MIN_WEIGHT && kg <= MAX_WEIGHT;
    }).map(function(w){ return { date: w.date, weight: Math.round(parseFloat(w.weight) * 10) / 10 }; })
      .sort(function(a, b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); }).slice(-1000);
    return { name: str(p.name, 24), height: str(p.height, 6), weightHistory: wh };
  }
  function sanitizeAttendance(a){
    if(!isObj(a)) return null;
    var out = {};
    safeKeys(a).forEach(function(k){ if(isValidDateKey(k) && a[k]) out[k] = true; });
    return out;
  }
  function sanitizeHistory(h){
    if(!isObj(h)) return null;
    var out = {};
    safeKeys(h).forEach(function(k){
      var e = h[k];
      if(isObj(e) && isValidDateKey(e.date)) out[k] = { date: e.date, sets: sanitizeSets(e.sets) };
    });
    return out;
  }
  function sanitizePRs(p){
    if(!isObj(p)) return null;
    var out = {};
    safeKeys(p).forEach(function(k){
      var e = p[k], l = isObj(e) ? num(e.load, MAX_LOAD) : NaN;
      if(!isNaN(l)) out[k] = { load: l, reps: str(e.reps, 12), date: str(e.date, 10) };
    });
    return out;
  }
  /* session.undo holds snapshots used to roll a session back; validate the shape too */
  function sanitizeUndo(u){
    if(!isObj(u)) return null;
    var out = { history:{}, prs:{}, prlogKeys:[] };
    if(isObj(u.history)) safeKeys(u.history).forEach(function(k){
      var e = u.history[k];
      if(e === null) out.history[k] = null;
      else if(isObj(e) && isValidDateKey(e.date)) out.history[k] = { date: e.date, sets: sanitizeSets(e.sets) };
    });
    if(isObj(u.prs)) safeKeys(u.prs).forEach(function(k){
      var e = u.prs[k], l = isObj(e) ? num(e.load, MAX_LOAD) : NaN;
      if(e === null) out.prs[k] = null;
      else if(!isNaN(l)) out.prs[k] = { load: l, reps: str(e.reps, 12), date: str(e.date, 10) };
    });
    if(Array.isArray(u.prlogKeys)) out.prlogKeys = u.prlogKeys.filter(function(k){ return typeof k === 'string'; }).slice(0, MAX_EXERCISES);
    return out;
  }
  function sanitizeSessions(arr){
    if(!Array.isArray(arr)) return null;
    var byDate = Object.create(null); // one session per date (later entries win)
    arr.forEach(function(s){
      if(!isObj(s) || !isValidDateKey(s.date) || !Array.isArray(s.exercises)) return;
      var rec = {
        date: s.date,
        dayIdx: (typeof s.dayIdx === 'number' && s.dayIdx >= 0 && s.dayIdx <= 6) ? s.dayIdx : new Date(s.date + 'T00:00:00').getDay(),
        exercises: s.exercises.filter(function(ex){ return isObj(ex) && typeof ex.name === 'string' && ex.name.trim(); })
          .slice(0, MAX_EXERCISES).map(function(ex){
            var out = { name: str(ex.name, 40), sets: sanitizeSets(ex.sets) };
            var rest = parseInt(ex.rest, 10);
            if(!isNaN(rest)) out.rest = clamp(rest, MIN_REST, MAX_REST);
            return out;
          })
      };
      var undo = sanitizeUndo(s.undo);
      if(undo) rec.undo = undo;
      byDate[s.date] = rec;
    });
    return Object.keys(byDate).sort().map(function(d){ return byDate[d]; });
  }
  function sanitizePRLog(arr){
    if(!Array.isArray(arr)) return null;
    return arr.filter(function(e){
      return isObj(e) && typeof e.name === 'string' && e.name.trim() && !isNaN(num(e.load, MAX_LOAD)) && isValidDateKey(e.date);
    }).slice(-5000).map(function(e){ return { name: str(e.name, 40), load: num(e.load, MAX_LOAD), date: e.date }; });
  }
  function sanitizeBadges(b){
    if(!isObj(b)) return null;
    var known = {};
    BADGE_DEFS.forEach(function(d){ known[d.id] = true; });
    var out = {};
    Object.keys(known).forEach(function(k){
      if(Object.prototype.hasOwnProperty.call(b, k) && isValidDateKey(b[k])) out[k] = b[k];
    });
    return out;
  }

  /* Run every stored value through the same sanitizers used for imports, so
     legacy/corrupted localStorage can't crash a render later. */
  function normalizeLoadedState(){
    workouts = sanitizeWorkouts(workouts) || {};
    attendance = sanitizeAttendance(attendance) || {};
    profile = sanitizeProfile(profile) || { name:'', height:'', weightHistory:[] };
    history = sanitizeHistory(history) || {};
    prs = sanitizePRs(prs) || {};
    sessions = sanitizeSessions(sessions) || [];
    prlog = sanitizePRLog(prlog) || [];
    badges = sanitizeBadges(badges) || {};
  }

  document.getElementById('importFileInput').addEventListener('change', function(e){
    var input = e.target;
    var file = input.files[0];
    if(!file) return;
    if(file.size > MAX_IMPORT_BYTES){
      showToast('Arquivo grande demais (máx. 5 MB)', 'error');
      input.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onerror = function(){ showToast('Não foi possível ler o arquivo', 'error'); input.value = ''; };
    reader.onload = async function(){
      var data;
      try{ data = JSON.parse(reader.result); }
      catch(err){ showToast('Arquivo inválido'); input.value = ''; return; }

      if(!isObj(data)){
        showToast('Arquivo não reconhecido');
        input.value = '';
        return;
      }

      /* Older exports (and the sample ficha files) only carry `workouts` at
         the top level; full backups carry every store. Restore whichever
         pieces are present and well-formed. */
      var nWorkouts = sanitizeWorkouts(isObj(data.workouts) ? data.workouts : data);
      var parts = [];
      var dayKeys = nWorkouts ? Object.keys(nWorkouts) : [];
      if(dayKeys.length) parts.push('ficha (' + dayKeys.map(function(k){ return WEEKDAY_FULL[parseInt(k,10)]; }).join(', ') + ')');
      var nProfile = sanitizeProfile(data.profile);
      var nAttendance = sanitizeAttendance(data.attendance);
      var nHistory = sanitizeHistory(data.history);
      var nPRs = sanitizePRs(data.prs);
      var nSessions = sanitizeSessions(data.sessions);
      var nPRLog = sanitizePRLog(data.prlog);
      if(nProfile) parts.push('perfil (nome/peso/altura)');
      if(nAttendance) parts.push('calendário de treinos');
      if(nHistory) parts.push('histórico de "última vez"');
      if(nPRs) parts.push('recordes pessoais');
      if(nSessions) parts.push('sessões (progresso)');
      var nBadges = sanitizeBadges(data.badges);
      if(nBadges) parts.push('conquistas');

      if(parts.length === 0){
        showToast('Nenhum dado reconhecido no arquivo');
        input.value = '';
        return;
      }

      var ok = await askConfirm(
        'Importar backup',
        'Isso vai substituir: ' + parts.join('; ') + '. Continuar?',
        'Importar'
      );
      if(!ok){ input.value = ''; return; }

      var previous = captureState();
      previous.workouts = deepCopy(workouts);
      previous.profile = deepCopy(profile);
      previous.badges = deepCopy(badges);

      cancelResync(); // a pending session resync must not run against the data we're about to replace
      if(dayKeys.length){
        dayKeys.forEach(function(k){ workouts[k] = nWorkouts[k]; });
        flushWorkouts();
      }
      if(nProfile){ profile = nProfile; saveJSON(LS_PROFILE, profile); }
      if(nAttendance){ attendance = nAttendance; persistAttendance(); }
      if(nHistory){ history = nHistory; persistHistory(); }
      if(nPRs){ prs = nPRs; persistPRs(); }
      if(nSessions){ sessions = nSessions; persistSessions(); }
      if(nPRLog){ prlog = nPRLog; persistPRLog(); }
      if(nBadges){ badges = nBadges; persistBadges(); }
      evaluateBadges(); // silently backfill anything the imported data already earns

      renderTodayStrip();
      renderDayTabs();
      renderDayPanel();
      if(document.getElementById('view-profile').classList.contains('active')) renderProfile();
      showUndoToast('Backup importado (' + parts.join('; ') + ')', function(){
        workouts = previous.workouts; flushWorkouts();
        profile = previous.profile; saveJSON(LS_PROFILE, profile);
        restoreState(previous);
        badges = previous.badges; persistBadges();
        renderTodayStrip();
        renderDayTabs();
        renderDayPanel();
        if(document.getElementById('view-profile').classList.contains('active')) renderProfile();
      });
      input.value = '';
    };
    reader.readAsText(file);
  });

  /* ---------- NAV BUTTONS ---------- */
  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ switchView(btn.dataset.view); });
  });

  /* ---------- KEYBOARD: Esc closes modals, Enter submits "new exercise" ---------- */
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      if(confirmBackdrop.classList.contains('open')) closeConfirm(false);
      else if(copyModalBackdrop.classList.contains('open')) closeCopyModal();
      else if(modalBackdrop.classList.contains('open')) closeModal();
    } else if(e.key === 'Enter' && modalBackdrop.classList.contains('open')
              && (e.target.id === 'exNameInput' || e.target.id === 'exSetsInput')){
      document.getElementById('modalSave').click();
    }
  });

  /* ---------- ONLINE / OFFLINE BADGE ---------- */
  function updateOnlineStatus(){
    var dot = document.getElementById('statusDot');
    dot.classList.toggle('offline', !navigator.onLine);
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  /* ---------- SERVICE WORKER ---------- */
  /* updateViaCache:'none' makes the browser check sw.js itself without using its
     HTTP cache, so a new version is noticed promptly. */
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(function(){ return navigator.serviceWorker.ready; })
        .then(function(){ setTimeout(checkOfflineReady, 1500); })
        .catch(function(){ checkOfflineReady(); });
    });
  }

  /* Tells you whether the app is really saved on the phone for offline use, so
     you can confirm it at home (with Wi-Fi) instead of finding out at the gym. */
  function checkOfflineReady(){
    var el = document.getElementById('offlineStatus');
    if(!el) return;
    function show(ok, text){
      el.textContent = text;
      el.className = 'offline-status ' + (ok ? 'ok' : 'bad');
    }
    if(!('caches' in window) || !('serviceWorker' in navigator)){
      show(false, '⚠ Este navegador não suporta uso offline');
      return;
    }
    var core = ['./index.html', './style.css', './app.js', './boot.js'];
    Promise.all(core.map(function(u){ return caches.match(u); })).then(function(found){
      var ok = found.every(Boolean) && !!navigator.serviceWorker.controller;
      show(ok, ok ? '✓ Pronto para uso offline' : '⚠ Ainda não disponível offline — abra o app uma vez com internet e recarregue');
    }).catch(function(){ show(false, '⚠ Não foi possível verificar o modo offline'); });
  }

  /* Best-effort request that the browser NOT auto-evict this site's storage
     under space pressure. Doesn't protect against the user (or the phone's
     "free up space" tools) explicitly clearing site data, but helps against
     silent automatic cleanup — which is the likelier cause of the data
     disappearing on its own. */
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(function(){});
  }

  /* Gently nudge toward exporting a backup if there's real data at risk and
     it's been a while (or never) since the last export. */
  function maybeSuggestBackup(){
    var hasData = Object.keys(workouts).some(function(k){
      return workouts[k] && workouts[k].exercises && workouts[k].exercises.length;
    });
    if(!hasData) return;
    var last = loadJSON(LS_LAST_EXPORT, null);
    if(!isValidDateKey(last)) last = null; // malformed value → treat as "never exported" (NaN would silence the nudge forever)
    var daysSince = last ?(new Date(todayKey()+'T00:00:00') - new Date(last+'T00:00:00')) / 86400000 : Infinity;
    if(daysSince >= 7){
      setTimeout(function(){ showToast('💾 Faça um backup: Perfil → Exportar backup completo'); }, 1400);
    }
  }
  maybeSuggestBackup();

  /* ---------- INIT ---------- */
  normalizeLoadedState(); // validate everything read from localStorage before the first render
  if(!ACCENTS.some(function(c){ return c.id === accentId; })) accentId = 'violet';
  applyTheme();
  applyAccent();
  evaluateBadges(); // silent backfill: existing history may already earn some badges

  /* Another tab/window of the app wrote to storage: this tab's in-memory copy is
     now stale and would overwrite those changes on its next save. */
  window.addEventListener('storage', function(e){
    if(e.key && e.key.indexOf('gymapp:') === 0 && e.key !== LS_ACCENT_COLORS){
      showToast('Dados alterados em outra aba — recarregue a página para evitar perder alterações', 'error');
    }
  });
  updateOnlineStatus();
  renderTodayStrip();
  renderDayTabs();
  renderDayPanel();
  renderRestTimer();

  /* Keep the splash on screen for a small minimum time so it never just
     flickers on a fast load — feels intentional instead of a glitch. */
  (function hideSplash(){
    var splash = document.getElementById('splash');
    if(!splash) return;
    var elapsed = Date.now() - (window.__gymappLoadStart || Date.now());
    var minDelay = Math.max(0, 500 - elapsed);
    setTimeout(function(){
      splash.classList.add('hide');
      setTimeout(function(){ splash.remove(); }, 450);
    }, minDelay);
  })();

})();
