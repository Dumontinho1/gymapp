/* GymApp - offline-first workout tracker */
(function(){
  'use strict';

  var LS_WORKOUTS = 'gymapp:workouts';
  var LS_ATTEND = 'gymapp:attendance';
  var LS_PROFILE = 'gymapp:profile';
  var LS_THEME = 'gymapp:theme';
  var LS_LASTDAY = 'gymapp:lastDay';

  var DAYS = [
    { idx:1, label:'Seg' }, { idx:2, label:'Ter' }, { idx:3, label:'Qua' },
    { idx:4, label:'Qui' }, { idx:5, label:'Sex' }, { idx:6, label:'Sáb' },
    { idx:0, label:'Dom' }
  ];
  var MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var WEEKDAY_FULL = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

  function loadJSON(key, fallback){
    try{
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    }catch(e){ return fallback; }
  }
  function saveJSON(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
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

  function getDayData(idx){
    if(!workouts[idx]) workouts[idx] = { name:'', exercises:[] };
    return workouts[idx];
  }

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
  }

  /* ---------- HOME: TODAY STRIP ---------- */
  function renderTodayStrip(){
    var now = new Date();
    document.getElementById('todayLabel').textContent = WEEKDAY_FULL[now.getDay()];
    document.getElementById('todayDate').textContent = pad2(now.getDate())+' de '+MONTHS[now.getMonth()]+' de '+now.getFullYear();
    var done = !!attendance[todayKey()];
    var btn = document.getElementById('btnCheckToday');
    btn.classList.toggle('done', done);
    document.getElementById('checkTodayLabel').textContent = done ? 'Treino concluído hoje' : 'Marcar treino de hoje';
  }

  /* ---------- DAY TABS ---------- */
  function renderDayTabs(){
    var wrap = document.getElementById('dayTabs');
    wrap.innerHTML = '';
    var todayIdx = new Date().getDay();
    DAYS.forEach(function(d){
      var el = document.createElement('div');
      var hasEx = getDayData(d.idx).exercises.length > 0;
      el.className = 'day-tab'
        + (d.idx === selectedDay ? ' active' : '')
        + (d.idx === todayIdx ? ' is-today' : '')
        + (hasEx ? ' has-exercises' : '');
      el.innerHTML = '<div class="dlabel">'+d.label+'</div><div class="ddot"></div>';
      el.addEventListener('click', function(){
        selectedDay = d.idx;
        saveJSON(LS_LASTDAY, selectedDay);
        renderDayTabs();
        renderDayPanel();
      });
      wrap.appendChild(el);
    });
  }

  /* ---------- DAY PANEL / EXERCISES ---------- */
  function renderDayPanel(){
    var data = getDayData(selectedDay);
    var nameInput = document.getElementById('dayNameInput');
    nameInput.value = data.name || '';

    var list = document.getElementById('exerciseList');
    list.innerHTML = '';
    if(data.exercises.length === 0){
      list.innerHTML = '<div class="empty-state">Nenhum exercício ainda.<br>Toque em "Adicionar exercício" para começar.</div>';
    }
    data.exercises.forEach(function(ex){
      list.appendChild(buildExerciseCard(ex));
    });
    resetRestTimer(false);
  }

  function buildExerciseCard(ex){
    var card = document.createElement('div');
    card.className = 'exercise-card';
    card.dataset.exId = ex.id;

    var head = document.createElement('div');
    head.className = 'exercise-card-head';
    head.innerHTML = '<div class="exname"></div><div class="exercise-actions">'
      + '<button class="icon-mini danger" data-act="del-ex" title="Remover exercício">🗑</button>'
      + '</div>';
    head.querySelector('.exname').textContent = ex.name;
    card.appendChild(head);

    var rows = document.createElement('div');
    rows.className = 'set-rows';
    ex.sets.forEach(function(s, i){
      rows.appendChild(buildSetRow(ex, s, i));
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

    head.querySelector('[data-act="del-ex"]').addEventListener('click', function(){
      var data = getDayData(selectedDay);
      data.exercises = data.exercises.filter(function(e){ return e.id !== ex.id; });
      persistWorkouts();
      renderDayPanel();
      renderDayTabs();
    });

    return card;
  }

  function buildSetRow(ex, s, i){
    var row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML =
      '<div class="setnum">'+(i+1)+'</div>'
      + '<div class="setfield"><input type="number" inputmode="numeric" min="0" placeholder="0" class="reps-input"><span class="unit">reps</span></div>'
      + '<div class="setfield"><input type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" class="load-input"><span class="unit">kg</span></div>'
      + '<button class="rm-set" title="Remover série">✕</button>';

    var repsInput = row.querySelector('.reps-input');
    var loadInput = row.querySelector('.load-input');
    repsInput.value = s.reps;
    loadInput.value = s.load;

    repsInput.addEventListener('input', function(){ s.reps = repsInput.value; persistWorkouts(); });
    loadInput.addEventListener('input', function(){ s.load = loadInput.value; persistWorkouts(); });

    row.querySelector('.rm-set').addEventListener('click', function(){
      ex.sets.splice(i,1);
      persistWorkouts();
      renderDayPanel();
    });

    return row;
  }

  function persistWorkouts(){ saveJSON(LS_WORKOUTS, workouts); }

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

  /* ---------- TODAY CHECK BUTTON ---------- */
  document.getElementById('btnCheckToday').addEventListener('click', function(){
    var k = todayKey();
    if(attendance[k]) delete attendance[k];
    else attendance[k] = true;
    saveJSON(LS_ATTEND, attendance);
    renderTodayStrip();
    renderDayTabs();
    if(document.getElementById('view-profile').classList.contains('active')) renderProfile();
  });

  /* ---------- REST TIMER ---------- */
  var REST_TOTAL = 90;
  var restRemaining = REST_TOTAL;
  var restRunning = false;
  var restInterval = null;
  var RING_CIRC = 2 * Math.PI * 52;

  var ringFg = document.getElementById('ringFg');
  var restTimeEl = document.getElementById('restTime');
  var restToggleBtn = document.getElementById('btnRestToggle');
  var restToggleLabel = document.getElementById('btnRestToggleLabel');
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
  }

  function beep(){
    try{
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach(function(t){
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 880;
        g.gain.value = 0.001;
        o.connect(g); g.connect(ctx.destination);
        var start = ctx.currentTime + t;
        g.gain.setValueAtTime(0.001, start);
        g.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
        o.start(start); o.stop(start + 0.18);
      });
    }catch(e){}
    if(navigator.vibrate) navigator.vibrate([200,80,200,80,200]);
  }

  function tickRest(){
    restRemaining--;
    if(restRemaining <= 0){
      restRemaining = 0;
      stopRestInterval();
      restRunning = false;
      beep();
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
    renderRestTimer();
    if(autoStart){ toggleRest(); }
  }
  function toggleRest(){
    if(restRunning){
      restRunning = false;
      stopRestInterval();
    } else {
      if(restRemaining <= 0) restRemaining = REST_TOTAL;
      restRunning = true;
      startRestInterval();
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
    renderStats();
    renderCalendar();
  }

  profileNameEl.addEventListener('input', function(){
    profile.name = profileNameEl.value;
    saveJSON(LS_PROFILE, profile);
  });
  profileHeightEl.addEventListener('input', function(){
    profile.height = profileHeightEl.value;
    saveJSON(LS_PROFILE, profile);
  });
  profileWeightEl.addEventListener('change', function(){
    var v = parseFloat(profileWeightEl.value);
    if(isNaN(v) || v <= 0) return;
    if(!profile.weightHistory) profile.weightHistory = [];
    var last = profile.weightHistory[profile.weightHistory.length-1];
    if(last && last.date === todayKey()){
      last.weight = v;
    } else {
      profile.weightHistory.push({ date: todayKey(), weight: v });
    }
    saveJSON(LS_PROFILE, profile);
    renderWeightTrend();
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

  document.getElementById('darkModeToggle').addEventListener('change', function(e){
    theme = e.target.checked ? 'dark' : 'light';
    saveJSON(LS_THEME, theme);
    applyTheme();
  });

  /* ---------- NAV BUTTONS ---------- */
  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ switchView(btn.dataset.view); });
  });

  /* ---------- ONLINE / OFFLINE BADGE ---------- */
  function updateOnlineStatus(){
    var dot = document.getElementById('statusDot');
    dot.classList.toggle('offline', !navigator.onLine);
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  /* ---------- SERVICE WORKER ---------- */
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(){});
    });
  }

  /* ---------- INIT ---------- */
  applyTheme();
  updateOnlineStatus();
  renderTodayStrip();
  renderDayTabs();
  renderDayPanel();
  renderRestTimer();

})();
