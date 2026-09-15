/* GymApp - offline-first workout tracker */
(function(){
  'use strict';

  var LS_WORKOUTS = 'gymapp:workouts';
  var LS_ATTEND = 'gymapp:attendance';
  var LS_PROFILE = 'gymapp:profile';
  var LS_THEME = 'gymapp:theme';
  var LS_LASTDAY = 'gymapp:lastDay';
  var LS_HISTORY = 'gymapp:history';

  var DEFAULT_REST = 90;

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
  var history = loadJSON(LS_HISTORY, {}); // { "supino reto": { date:"2026-09-10", sets:[{reps,load}] } }

  function getDayData(idx){
    if(!workouts[idx]) workouts[idx] = { name:'', exercises:[] };
    return workouts[idx];
  }

  function historyKey(name){ return (name||'').trim().toLowerCase(); }

  function persistHistory(){ saveJSON(LS_HISTORY, history); }

  /* Snapshot today's filled-in sets per exercise name, so next time it's trained
     the previous performance shows up as a reference. Only exercises with at
     least one filled set are recorded, and only once per exercise per day. */
  function snapshotHistoryForDay(dayIdx){
    var data = getDayData(dayIdx);
    var k = todayKey();
    data.exercises.forEach(function(ex){
      var filledSets = ex.sets.filter(function(s){ return s.reps || s.load; });
      if(filledSets.length === 0) return;
      history[historyKey(ex.name)] = { date: k, sets: filledSets.map(function(s){ return { reps: s.reps, load: s.load }; }) };
    });
    persistHistory();
  }

  function formatDateShort(dateKey){
    var parts = dateKey.split('-');
    return parts[2] + '/' + parts[1];
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
    if(ex.restSeconds == null) ex.restSeconds = DEFAULT_REST;

    var card = document.createElement('div');
    card.className = 'exercise-card';
    card.dataset.exId = ex.id;

    var head = document.createElement('div');
    head.className = 'exercise-card-head';
    head.innerHTML = '<div class="exname-wrap">'
      + '<button class="drag-handle" title="Arrastar para reordenar">⠿</button>'
      + '<div class="exname"></div></div>'
      + '<div class="exercise-actions">'
      + '<button class="icon-mini danger" data-act="del-ex" title="Remover exercício">🗑</button>'
      + '</div>';
    head.querySelector('.exname').textContent = ex.name;
    card.appendChild(head);

    var lastEntry = history[historyKey(ex.name)];
    if(lastEntry && lastEntry.date !== todayKey()){
      var lastLine = document.createElement('div');
      lastLine.className = 'last-time';
      var summary = lastEntry.sets.map(function(s){
        return (s.reps || '-') + '×' + (s.load || '-') + 'kg';
      }).join(', ');
      lastLine.innerHTML = '<span class="lt-label">Última vez (' + formatDateShort(lastEntry.date) + '):</span>' + summary;
      card.appendChild(lastLine);
    }

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
      if(!isNaN(v) && v > 0) ex.restSeconds = v;
      persistWorkouts();
    });
    restRow.querySelector('.btn-start-ex-rest').addEventListener('click', function(){
      startRestFor(ex.name, ex.restSeconds);
    });
    card.appendChild(restRow);

    head.querySelector('[data-act="del-ex"]').addEventListener('click', function(){
      var data = getDayData(selectedDay);
      data.exercises = data.exercises.filter(function(e){ return e.id !== ex.id; });
      persistWorkouts();
      renderDayPanel();
      renderDayTabs();
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
        data.exercises.sort(function(a, b){
          return newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id);
        });
        persistWorkouts();
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
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
      btn.addEventListener('click', function(){
        copyWorkoutTo(d.idx);
      });
      listEl.appendChild(btn);
    });
    copyModalBackdrop.classList.add('open');
  }
  function closeCopyModal(){ copyModalBackdrop.classList.remove('open'); }
  function copyWorkoutTo(targetIdx){
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
  }
  document.getElementById('btnCopyDay').addEventListener('click', openCopyModal);
  document.getElementById('copyModalCancel').addEventListener('click', closeCopyModal);
  copyModalBackdrop.addEventListener('click', function(e){ if(e.target === copyModalBackdrop) closeCopyModal(); });

  /* ---------- TODAY CHECK BUTTON ---------- */
  document.getElementById('btnCheckToday').addEventListener('click', function(){
    var k = todayKey();
    if(attendance[k]){
      delete attendance[k];
    } else {
      attendance[k] = true;
      snapshotHistoryForDay(new Date().getDay());
    }
    saveJSON(LS_ATTEND, attendance);
    renderTodayStrip();
    renderDayTabs();
    renderDayPanel();
    if(document.getElementById('view-profile').classList.contains('active')) renderProfile();
  });

  /* ---------- REST TIMER (variable duration, per-exercise or general) ---------- */
  var REST_TOTAL = DEFAULT_REST;
  var restRemaining = REST_TOTAL;
  var restRunning = false;
  var restInterval = null;
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
    REST_TOTAL = secs;
    restLabel = 'Descanso — ' + exerciseName;
    restRemaining = secs;
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
  async function acquireWakeLock(){
    if(!('wakeLock' in navigator)) return;
    try{
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function(){ wakeLock = null; });
    }catch(e){ wakeLock = null; }
  }
  function releaseWakeLock(){
    if(wakeLock){ wakeLock.release().catch(function(){}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible' && restRunning && !wakeLock){
      acquireWakeLock();
    }
  });

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
      releaseWakeLock();
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
    releaseWakeLock();
    renderRestTimer();
    if(autoStart){ toggleRest(); }
  }
  function toggleRest(){
    if(restRunning){
      restRunning = false;
      stopRestInterval();
      releaseWakeLock();
    } else {
      if(restRemaining <= 0) restRemaining = REST_TOTAL;
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
