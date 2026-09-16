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
  var autosaveTimer = null;
  function flashAutosave(){
    var el = document.getElementById('autosaveBadge');
    if(!el) return;
    el.classList.add('show');
    if(autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function(){ el.classList.remove('show'); }, 1100);
  }
  function saveJSON(key, val){
    try{
      localStorage.setItem(key, JSON.stringify(val));
      flashAutosave();
    }catch(e){}
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
  var sessions = loadJSON(LS_SESSIONS, []); // [{ date, dayIdx, exercises:[{name, sets:[{reps,load}]}] }]
  var prlog = loadJSON(LS_PRLOG, []); // [{ name, load, date }] — appended each time a PR is broken
  var notifPref = loadJSON(LS_NOTIF, false);

  function getDayData(idx){
    if(!workouts[idx]) workouts[idx] = { name:'', exercises:[] };
    return workouts[idx];
  }

  function historyKey(name){ return (name||'').trim().toLowerCase(); }

  function persistHistory(){ saveJSON(LS_HISTORY, history); }

  /* Snapshot today's filled-in sets per exercise name, so next time it's trained
     the previous performance shows up as a reference. Only exercises with at
     least one filled set are recorded, and only once per exercise per day. */
  function persistSessions(){ saveJSON(LS_SESSIONS, sessions); }

  function snapshotHistoryForDay(dayIdx){
    var data = getDayData(dayIdx);
    var k = todayKey();
    var sessionExercises = [];
    data.exercises.forEach(function(ex){
      var filledSets = ex.sets.filter(function(s){ return s.reps || s.load; });
      if(filledSets.length === 0) return;
      var setsCopy = filledSets.map(function(s){ return { reps: s.reps, load: s.load }; });
      history[historyKey(ex.name)] = { date: k, sets: setsCopy };
      sessionExercises.push({ name: ex.name, sets: setsCopy });
    });
    persistHistory();

    if(sessionExercises.length){
      var record = { date: k, dayIdx: dayIdx, exercises: sessionExercises };
      var existingIdx = sessions.findIndex(function(s){ return s.date === k; });
      if(existingIdx > -1) sessions[existingIdx] = record; else sessions.push(record);
      persistSessions();
    }
  }

  /* Total volume (reps x load, summed across all filled sets) of one logged session. */
  function sessionVolume(session){
    var total = 0;
    session.exercises.forEach(function(ex){
      ex.sets.forEach(function(s){
        var r = parseFloat(s.reps), l = parseFloat(s.load);
        if(!isNaN(r) && !isNaN(l)) total += r * l;
      });
    });
    return total;
  }

  function formatDateShort(dateKey){
    var parts = dateKey.split('-');
    return parts[2] + '/' + parts[1];
  }

  /* ---------- PERSONAL RECORDS (heaviest load ever logged per exercise) ---------- */
  function persistPRs(){ saveJSON(LS_PR, prs); }

  /* Updates the stored PR for an exercise if the given load beats it.
     Returns true only when an EXISTING record was just broken (not the
     first-ever entry), which is the moment worth celebrating. */
  function persistPRLog(){ saveJSON(LS_PRLOG, prlog); }

  function checkAndUpdatePR(exName, loadStr, repsStr){
    var load = parseFloat(String(loadStr).replace(',', '.'));
    if(isNaN(load) || load <= 0) return false;
    var key = historyKey(exName);
    var current = prs[key];
    var brokeRecord = !!current && load > current.load;
    if(!current || load > current.load){
      prs[key] = { load: load, reps: repsStr || '', date: todayKey() };
      persistPRs();
      if(brokeRecord){
        prlog.push({ name: exName, load: load, date: todayKey() });
        persistPRLog();
      }
    }
    return brokeRecord;
  }

  /* ---------- TOAST (info / PR celebration / undo) ---------- */
  var toastEl = document.getElementById('toast');
  var toastMsgEl = document.getElementById('toastMsg');
  var toastUndoBtn = document.getElementById('toastUndoBtn');
  var toastTimer = null;
  var pendingUndo = null;

  function showToast(msg){
    pendingUndo = null;
    toastUndoBtn.hidden = true;
    toastMsgEl.textContent = msg;
    toastEl.classList.add('show');
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  }

  /* Shows a toast with a "Desfazer" button; if tapped before it expires, undoFn() runs. */
  function showUndoToast(msg, undoFn){
    pendingUndo = undoFn;
    toastUndoBtn.hidden = false;
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

  /* ---------- GENERIC CONFIRM MODAL (used by every delete/overwrite action) ---------- */
  var confirmBackdrop = document.getElementById('confirmModalBackdrop');
  var confirmTitleEl = document.getElementById('confirmModalTitle');
  var confirmMsgEl = document.getElementById('confirmModalMsg');
  var confirmOkBtn = document.getElementById('confirmModalOk');
  var confirmCancelBtn = document.getElementById('confirmModalCancel');
  var confirmResolver = null;

  function askConfirm(title, message, okLabel){
    confirmTitleEl.textContent = title;
    confirmMsgEl.textContent = message;
    confirmOkBtn.textContent = okLabel || 'Remover';
    confirmBackdrop.classList.add('open');
    return new Promise(function(resolve){ confirmResolver = resolve; });
  }
  function closeConfirm(result){
    confirmBackdrop.classList.remove('open');
    if(confirmResolver){ confirmResolver(result); confirmResolver = null; }
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
    document.getElementById('btnLiveStart').disabled = data.exercises.length === 0;

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

    var prEntry = prs[historyKey(ex.name)];

    var head = document.createElement('div');
    head.className = 'exercise-card-head';
    head.innerHTML = '<div class="exname-wrap">'
      + '<button class="drag-handle" title="Arrastar para reordenar">⠿</button>'
      + '<input type="text" class="exname-input" maxlength="40" title="Toque para renomear">'
      + (prEntry ? '<span class="pr-badge">🏆 ' + prEntry.load + 'kg</span>' : '')
      + '</div>'
      + '<div class="exercise-actions">'
      + '<button class="icon-mini danger" data-act="del-ex" title="Remover exercício">🗑</button>'
      + '</div>';
    var exNameInput = head.querySelector('.exname-input');
    exNameInput.value = ex.name;
    exNameInput.addEventListener('input', function(){
      ex.name = exNameInput.value;
      persistWorkouts();
    });
    exNameInput.addEventListener('change', function(){
      var parent = card.parentElement;
      if(!parent) return;
      var fresh = buildExerciseCard(ex);
      parent.replaceChild(fresh, card);
      renderDayTabs();
    });
    card.appendChild(head);

    function handlePRCheck(loadVal, repsVal){
      var brokeRecord = checkAndUpdatePR(ex.name, loadVal, repsVal);
      if(!brokeRecord) return;
      var parent = card.parentElement;
      if(!parent) return;
      var freshCard = buildExerciseCard(ex);
      freshCard.classList.add('pr-flash');
      parent.replaceChild(freshCard, card);
      showToast('🏆 Novo recorde em ' + ex.name + ': ' + prs[historyKey(ex.name)].load + 'kg!');
      if(navigator.vibrate) navigator.vibrate([80,40,80]);
    }

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
      rows.appendChild(buildSetRow(ex, s, i, prEntry, handlePRCheck));
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

  function buildSetRow(ex, s, i, prEntry, onPRCheck){
    var row = document.createElement('div');
    row.className = 'set-row';
    var isPRSet = prEntry && s.load !== '' && parseFloat(s.load) === prEntry.load;
    row.innerHTML =
      '<div class="setnum">'+(i+1)+'</div>'
      + '<div class="setfield"><input type="number" inputmode="numeric" min="0" placeholder="0" class="reps-input"><span class="unit">reps</span></div>'
      + '<div class="setfield' + (isPRSet ? ' pr-set' : '') + '"><input type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" class="load-input"><span class="unit">kg</span>' + (isPRSet ? '<span class="pr-icon">🏆</span>' : '') + '</div>'
      + '<button class="rm-set" title="Remover série">✕</button>';

    var repsInput = row.querySelector('.reps-input');
    var loadInput = row.querySelector('.load-input');
    repsInput.value = s.reps;
    loadInput.value = s.load;

    repsInput.addEventListener('input', function(){ s.reps = repsInput.value; persistWorkouts(); });
    loadInput.addEventListener('input', function(){ s.load = loadInput.value; persistWorkouts(); });
    loadInput.addEventListener('change', function(){
      if(onPRCheck) onPRCheck(loadInput.value, repsInput.value);
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
    saveJSON(LS_ATTEND, attendance);
    renderTodayStrip();
    renderDayTabs();
    renderDayPanel();
    if(document.getElementById('view-profile').classList.contains('active')) renderProfile();
  }
  document.getElementById('btnCheckToday').addEventListener('click', function(){
    var k = todayKey();
    if(attendance[k]){
      delete attendance[k];
      refreshAfterAttendanceChange();
      showUndoToast('Treino de hoje desmarcado', function(){
        attendance[k] = true;
        refreshAfterAttendanceChange();
      });
    } else {
      attendance[k] = true;
      snapshotHistoryForDay(new Date().getDay());
      refreshAfterAttendanceChange();
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
    if(document.visibilityState !== 'visible') return;
    if(restRunning){
      if(!wakeLock) acquireWakeLock();
      tickRest(); // snap the display to the true elapsed time right away
    }
    if(live.restRunning) tickLiveRest();
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

  /* Best-effort alert while the app is minimized: shows a silent system
     notification via the Service Worker so you notice rest is over even if
     you're on another app. Android Chrome keeps this reliable in the
     background; iOS Safari's PWA background limits mean it mostly fires once
     you reopen/foreground the app rather than while deeply minimized. */
  function notifyRestDone(label){
    if(!notifPref) return;
    if(!('Notification' in window) || Notification.permission !== 'granted') return;
    if(!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function(reg){
      reg.showNotification('Descanso finalizado', {
        body: (label || 'Descanso') + ' — hora de voltar pro treino 💪',
        silent: true,
        tag: 'gymapp-rest',
        renotify: true,
        icon: 'icon.svg'
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
  }

  function renderBMI(){
    var badge = document.getElementById('bmiBadge');
    var hist = profile.weightHistory || [];
    var weight = hist.length ? parseFloat(hist[hist.length-1].weight) : NaN;
    var heightCm = parseFloat(profile.height);
    if(isNaN(weight) || isNaN(heightCm) || heightCm <= 0){
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
    renderWeekBars();
    renderExercisePicker();
    renderPRRanking();
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

  function collectExerciseNames(){
    var names = {};
    sessions.forEach(function(s){
      s.exercises.forEach(function(ex){ names[ex.name] = true; });
    });
    return Object.keys(names).sort(function(a,b){ return a.localeCompare(b, 'pt-BR'); });
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
        var l = parseFloat(st.load);
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

  /* ---------- IMPORT / EXPORT WORKOUTS (JSON) ---------- */
  document.getElementById('btnExportWorkouts').addEventListener('click', function(){
    var payload = { app: 'GymApp', type: 'workouts', version: 1, exportedAt: todayKey(), workouts: workouts };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gymapp-ficha-' + todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    showToast('Ficha exportada');
  });

  document.getElementById('btnImportWorkouts').addEventListener('click', function(){
    document.getElementById('importFileInput').click();
  });

  document.getElementById('importFileInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = async function(){
      var data;
      try{ data = JSON.parse(reader.result); }
      catch(err){ showToast('Arquivo inválido'); e.target.value = ''; return; }

      var imported = data && data.workouts ? data.workouts : data;
      if(!imported || typeof imported !== 'object'){
        showToast('Arquivo não reconhecido');
        e.target.value = '';
        return;
      }

      var dayKeys = Object.keys(imported).filter(function(k){ return DAYS.some(function(d){ return String(d.idx) === k; }); });
      if(dayKeys.length === 0){
        showToast('Nenhum dia válido encontrado no arquivo');
        e.target.value = '';
        return;
      }
      var dayNames = dayKeys.map(function(k){ return WEEKDAY_FULL[parseInt(k,10)]; }).join(', ');

      var ok = await askConfirm(
        'Importar ficha',
        'Isso vai substituir o treino de: ' + dayNames + '. Os outros dias não são afetados. Continuar?',
        'Importar'
      );
      if(!ok){ e.target.value = ''; return; }

      var previousSnapshot = {};
      dayKeys.forEach(function(k){
        previousSnapshot[k] = workouts[k];
        var importedDay = imported[k];
        importedDay.exercises = (importedDay.exercises || []).map(function(ex){
          return {
            id: ex.id || uid(),
            name: ex.name || 'Exercício',
            restSeconds: ex.restSeconds || DEFAULT_REST,
            sets: (ex.sets || []).map(function(s){ return { reps: s.reps || '', load: s.load || '' }; })
          };
        });
        workouts[k] = { name: importedDay.name || '', exercises: importedDay.exercises };
      });
      persistWorkouts();
      renderDayTabs();
      renderDayPanel();
      showUndoToast('Ficha importada (' + dayNames + ')', function(){
        dayKeys.forEach(function(k){
          if(previousSnapshot[k]) workouts[k] = previousSnapshot[k]; else delete workouts[k];
        });
        persistWorkouts();
        renderDayTabs();
        renderDayPanel();
      });
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  /* ---------- NAV BUTTONS ---------- */
  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ switchView(btn.dataset.view); });
  });

  /* ---------- LIVE WORKOUT MODE ---------- */
  function formatMMSS(total){
    var m = Math.floor(total/60), s = total%60;
    return pad2(m) + ':' + pad2(s);
  }

  var live = {
    exercises: [], exIndex: 0, setIndex: 0, startTime: 0,
    volume: 0, prCount: 0, restInterval: null, restRemaining: 0,
    restTotal: 0, restRunning: false, restEndAt: 0, elapsedInterval: null
  };

  var liveOverlay = document.getElementById('liveOverlay');
  var liveScreenMain = document.getElementById('liveScreenMain');
  var liveRestBanner = document.getElementById('liveRestBanner');
  var liveSummaryEl = document.getElementById('liveSummary');
  var liveRingFg = document.getElementById('liveRingFg');
  var LIVE_RING_CIRC = 2 * Math.PI * 52;
  liveRingFg.style.strokeDasharray = LIVE_RING_CIRC;

  function openLiveMode(){
    var data = getDayData(selectedDay);
    if(!data.exercises.length) return;
    live.exercises = data.exercises;
    live.exIndex = 0;
    live.setIndex = 0;
    live.startTime = Date.now();
    live.volume = 0;
    live.prCount = 0;
    liveSummaryEl.classList.remove('show');
    liveRestBanner.classList.remove('show');
    liveOverlay.classList.add('open');
    renderLiveSet();
    updateLiveElapsed();
    live.elapsedInterval = setInterval(updateLiveElapsed, 1000);
    acquireWakeLock();
  }

  function updateLiveElapsed(){
    var secs = Math.floor((Date.now() - live.startTime) / 1000);
    document.getElementById('liveElapsed').textContent = formatMMSS(secs);
  }

  function currentLiveExercise(){ return live.exercises[live.exIndex]; }

  function renderLiveSet(){
    var ex = currentLiveExercise();
    if(!ex){ finishLiveWorkout(); return; }
    if(ex.restSeconds == null) ex.restSeconds = DEFAULT_REST;
    var set = ex.sets[live.setIndex];
    if(!set){ goNextExercise(); return; }

    var totalSets = live.exercises.reduce(function(sum,e){ return sum + e.sets.length; }, 0);
    var doneSets = 0;
    for(var i=0;i<live.exIndex;i++) doneSets += live.exercises[i].sets.length;
    doneSets += live.setIndex;
    document.getElementById('liveProgressFill').style.width = (totalSets ? (doneSets/totalSets*100) : 0) + '%';
    document.getElementById('liveStep').textContent = 'Exercício ' + (live.exIndex+1) + ' de ' + live.exercises.length;
    document.getElementById('liveExName').textContent = ex.name;

    var prEntry = prs[historyKey(ex.name)];
    var prBadge = document.getElementById('liveExPR');
    if(prEntry){ prBadge.hidden = false; prBadge.textContent = '🏆 PR: ' + prEntry.load + 'kg'; }
    else prBadge.hidden = true;

    var lastEntry = history[historyKey(ex.name)];
    var lastEl = document.getElementById('liveExLast');
    if(lastEntry && lastEntry.date !== todayKey()){
      lastEl.hidden = false;
      lastEl.textContent = 'Última vez (' + formatDateShort(lastEntry.date) + '): '
        + lastEntry.sets.map(function(s){ return (s.reps||'-')+'×'+(s.load||'-')+'kg'; }).join(', ');
    } else {
      lastEl.hidden = true;
    }

    document.getElementById('liveSetLabel').textContent = 'Série ' + (live.setIndex+1) + ' de ' + ex.sets.length;
    document.getElementById('liveRepsInput').value = set.reps;
    document.getElementById('liveLoadInput').value = set.load;

    document.getElementById('livePrevEx').disabled = (live.exIndex === 0);
    document.getElementById('liveNextEx').disabled = (live.exIndex === live.exercises.length - 1);
  }

  function goNextExercise(){
    live.exIndex++;
    live.setIndex = 0;
    if(live.exIndex >= live.exercises.length){ finishLiveWorkout(); return; }
    renderLiveSet();
  }

  function updateLiveRingFg(){
    var frac = live.restTotal ? live.restRemaining / live.restTotal : 0;
    liveRingFg.style.strokeDashoffset = LIVE_RING_CIRC * (1-frac);
    liveRingFg.classList.toggle('warn', live.restRemaining <= 15 && live.restRemaining > 0);
  }

  function startLiveRest(secs){
    live.restTotal = secs;
    live.restRemaining = secs;
    live.restEndAt = Date.now() + secs*1000;
    live.restRunning = true;
    liveRestBanner.classList.add('show');
    document.getElementById('liveRestTime').textContent = formatMMSS(secs);
    updateLiveRingFg();
    acquireWakeLock();
    clearInterval(live.restInterval);
    live.restInterval = setInterval(tickLiveRest, 1000);
  }

  function tickLiveRest(){
    if(!live.restRunning) return;
    live.restRemaining = Math.max(0, Math.round((live.restEndAt - Date.now()) / 1000));
    if(live.restRemaining <= 0){
      live.restRemaining = 0;
      clearInterval(live.restInterval);
      live.restRunning = false;
      beep();
      notifyRestDone(currentLiveExercise() ? currentLiveExercise().name : 'Treino ao vivo');
      endLiveRest();
      return;
    }
    document.getElementById('liveRestTime').textContent = formatMMSS(live.restRemaining);
    updateLiveRingFg();
  }

  function endLiveRest(){
    live.restRunning = false;
    liveRestBanner.classList.remove('show');
    var ex = currentLiveExercise();
    if(ex && live.setIndex >= ex.sets.length) goNextExercise();
    else renderLiveSet();
  }

  function finishLiveWorkout(){
    live.restRunning = false;
    clearInterval(live.elapsedInterval);
    clearInterval(live.restInterval);
    liveRestBanner.classList.remove('show');
    releaseWakeLock();
    var elapsedSecs = Math.floor((Date.now() - live.startTime)/1000);
    document.getElementById('summaryTime').textContent = formatMMSS(elapsedSecs);
    document.getElementById('summaryVolume').textContent = Math.round(live.volume) + ' kg';
    document.getElementById('summaryPRs').textContent = live.prCount;
    liveSummaryEl.classList.add('show');
  }

  document.getElementById('btnLiveStart').addEventListener('click', openLiveMode);

  document.getElementById('liveCompleteSet').addEventListener('click', function(){
    var ex = currentLiveExercise();
    var set = ex.sets[live.setIndex];
    var reps = document.getElementById('liveRepsInput').value;
    var load = document.getElementById('liveLoadInput').value;
    set.reps = reps; set.load = load;
    persistWorkouts();

    var r = parseFloat(reps), l = parseFloat(load);
    if(!isNaN(r) && !isNaN(l)) live.volume += r*l;

    var brokeRecord = checkAndUpdatePR(ex.name, load, reps);
    if(brokeRecord){
      live.prCount++;
      showToast('🏆 Novo recorde em ' + ex.name + ': ' + prs[historyKey(ex.name)].load + 'kg!');
      if(navigator.vibrate) navigator.vibrate([80,40,80]);
    }

    live.setIndex++;
    var restSecs = ex.restSeconds || DEFAULT_REST;
    var hasMore = live.setIndex < ex.sets.length || live.exIndex < live.exercises.length - 1;
    if(hasMore) startLiveRest(restSecs);
    else finishLiveWorkout();
  });

  document.getElementById('liveSkipRest').addEventListener('click', function(){
    live.restRunning = false;
    clearInterval(live.restInterval);
    endLiveRest();
  });

  document.getElementById('liveNextEx').addEventListener('click', function(){
    live.restRunning = false;
    clearInterval(live.restInterval);
    liveRestBanner.classList.remove('show');
    live.exIndex = Math.min(live.exIndex+1, live.exercises.length-1);
    live.setIndex = 0;
    renderLiveSet();
  });
  document.getElementById('livePrevEx').addEventListener('click', function(){
    live.restRunning = false;
    clearInterval(live.restInterval);
    liveRestBanner.classList.remove('show');
    live.exIndex = Math.max(live.exIndex-1, 0);
    live.setIndex = 0;
    renderLiveSet();
  });

  document.getElementById('liveClose').addEventListener('click', async function(){
    var ok = await askConfirm(
      'Encerrar treino ao vivo',
      'As séries já preenchidas foram salvas, mas o treino não será marcado como concluído no calendário. Encerrar mesmo assim?',
      'Encerrar'
    );
    if(!ok) return;
    live.restRunning = false;
    clearInterval(live.restInterval);
    clearInterval(live.elapsedInterval);
    liveRestBanner.classList.remove('show');
    liveSummaryEl.classList.remove('show');
    liveOverlay.classList.remove('open');
    releaseWakeLock();
    renderDayPanel();
    renderDayTabs();
  });

  document.getElementById('liveSummaryClose').addEventListener('click', function(){
    liveSummaryEl.classList.remove('show');
    liveOverlay.classList.remove('open');
    if(!attendance[todayKey()]) attendance[todayKey()] = true;
    snapshotHistoryForDay(selectedDay);
    refreshAfterAttendanceChange();
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
