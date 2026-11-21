/* Кооператив для «Красные цифры»: 2 игрока.
   Глава 1: синхронизация переходов между сценами и позиции второго игрока.
   Глава 2: хост ведёт мир (фазы, таймеры, монстр, двери, улики), гость присылает
   свои действия и получает снимок мира. Каждый видит второго игрока в квартире. */
(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const MP = {
    ws: null, code: null, role: null, peer: false, inRoom: false,
    remote: false, applying: false, lastSent: "",
    peerScene: null, peerRoom: null, peerHide: false,
    caughtFor: null, morningDone: false,
    nick: null, peerNick: null
  };
  const $m = id => document.getElementById(id);
  const C = () => window.Ch2;
  const ROOM_NAMES = { corridor: "Коридор", living: "Гостиная", kitchen: "Кухня", bedroom: "Комната", bathroom: "Ванная" };

  function coop() { return MP.inRoom && MP.peer && !!C(); }
  function isGuest() { return MP.role === "guest"; }
  // Гость не ведёт фазы сам: он просит хоста, а применяет только снимок
  function guestOnly() { return coop() && isGuest() && !MP.applying; }

  function wsUrl() {
    return (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/ws";
  }

  function sendMsg(o) {
    if (MP.ws && MP.ws.readyState === 1) MP.ws.send(JSON.stringify(o));
  }

  function setStatus(text, color) {
    const el = $m("mpStatus");
    if (el) {
      el.textContent = text;
      el.style.color = color || "";
    }
  }

  function connect(onOpen) {
    if (MP.ws && MP.ws.readyState <= 1) {
      if (onOpen) onOpen();
      return;
    }
    const ws = new WebSocket(wsUrl());
    MP.ws = ws;
    ws.onopen = () => { if (onOpen) onOpen(); };
    ws.onclose = () => {
      MP.peer = false;
      MP.code = null;
      MP.role = null;
      MP.peerScene = null;
      MP.peerRoom = null;
      hideGhost();
      if (MP.inRoom) setStatus("Соединение потеряно", "#ffb3b3");
      MP.inRoom = false;
      updateBtn();
    };
    ws.onerror = () => setStatus("Не удалось подключиться к серверу", "#ffb3b3");
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      handle(m);
    };
  }

  function handle(m) {
    if (m.t === "joined") {
      MP.code = m.code;
      MP.role = m.role;
      MP.inRoom = true;
      renderRoomBox();
      updateBtn();
      return;
    }
    if (m.t === "error") {
      setStatus(m.msg, "#ffb3b3");
      return;
    }
    if (m.t === "peer") {
      if (m.state === "joined") {
        MP.peer = true;
        MP.peerNick = m.nick || null;
        setStatus((MP.peerNick ? "Игрок «" + MP.peerNick + "» подключился" : "Второй игрок подключён"), "#9be89b");
      } else if (m.state === "left") {
        MP.peer = false;
        MP.inRoom = false;
        MP.code = null;
        MP.peerScene = null;
        MP.peerRoom = null;
        hideGhost();
        setStatus("Второй игрок вышел, комната закрыта", "#ffb3b3");
        updateBtn();
      }
      renderRoomBox();
      return;
    }
    if (m.t === "go") { applyRemoteGo(m.n, m.d); return; }
    if (m.t === "pos") { showGhost(m); return; }
    if (m.t === "c2s") { if (isGuest()) applySnapshot(m); return; }
    if (m.t === "c2req") { if (MP.role === "host") hostRequest(m); return; }
    if (m.t === "c2up") { if (MP.role === "host") hostMergeFound(m); return; }
    if (m.t === "c2") {
      if (m.op === "caught" && isGuest() && C() && C().active) C().caughtByMonster();
    }
  }

  // Переход главы 1, который пришёл от второго игрока
  function applyRemoteGo(n, door) {
    if (!n) return;
    if (window._currentSceneId === n) return; // уже там, дубль от таймера
    if (door) window._doorNum = door;
    MP.remote = true;
    try {
      window.go(n);
    } catch (e) {
      // сцена не найдена или игра не готова: тихо пропускаем
    } finally {
      MP.remote = false;
    }
  }

  /* ---------- Ghost: второй игрок на экране ---------- */
  let ghost = null;
  function ensureGhost() {
    if (ghost) return ghost;
    const walk = $("walk");
    const src = $("wk");
    if (!walk || !src) return null;
    ghost = document.createElementNS(SVGNS, "g");
    ghost.setAttribute("id", "ghostWk");
    ghost.style.display = "none";
    ghost.style.opacity = "0.6";
    ghost.style.filter = "hue-rotate(150deg) saturate(1.5)";
    ghost.innerHTML = src.innerHTML;
    walk.appendChild(ghost);
    return ghost;
  }

  function hideGhost() {
    if (ghost) ghost.style.display = "none";
  }

  function showGhost(p) {
    MP.peerScene = p.s || null;
    MP.peerRoom = p.r || null;
    MP.peerHide = !!p.h;
    const g = ensureGhost();
    if (!g) return;
    const c = C();
    const inCh2 = !!(c && c.active);
    let visible;
    if (inCh2) visible = p.s === "ch2" && p.r === c.room && !p.h;
    else visible = !!p.s && p.s === window._currentSceneId;
    if (!MP.peer || !visible) {
      g.style.display = "none";
      return;
    }
    const sc = 0.85 + 0.15 * ((p.y - 140) / 36);
    g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${(p.y - 172 * sc).toFixed(1)}) scale(${sc.toFixed(3)})`);
    const f = p.f || "B";
    const B = g.querySelector("#wvB"), F = g.querySelector("#wvF"), S = g.querySelector("#wvS");
    if (B) B.style.display = f === "B" ? "" : "none";
    if (F) F.style.display = f === "F" ? "" : "none";
    if (S) {
      S.style.display = (f === "L" || f === "R") ? "" : "none";
      S.setAttribute("transform", f === "L" ? "scale(-1 1)" : "");
    }
    g.style.display = "";
  }

  // Отправляем свою позицию раз в 100 мс, только если она изменилась
  setInterval(() => {
    if (!MP.peer || !window.Walk || Walk.hidden) return;
    const c = C();
    const inCh2 = !!(c && c.active);
    const s = inCh2 ? "ch2" : window._currentSceneId;
    if (!s) return;
    const payload = {
      t: "pos", s,
      r: inCh2 ? c.room : null,
      h: inCh2 && c.hiding ? 1 : 0,
      x: Math.round(Walk.x * 10) / 10,
      y: Math.round(Walk.y * 10) / 10,
      f: Walk.face
    };
    const key = JSON.stringify(payload);
    if (key === MP.lastSent) return;
    MP.lastSent = key;
    sendMsg(payload);
  }, 100);

  /* ---------- Перехват переходов главы 1 ---------- */
  const origGo = window.go;
  window.go = function (n) {
    const inCh2 = !!(C() && C().active);
    if (!MP.remote && MP.peer && !inCh2 && n && n !== "menu") {
      sendMsg({ t: "go", n, d: window._doorNum });
    }
    return origGo.apply(this, arguments);
  };

  // Начало игры идёт через show('start') после окна правил, поэтому шлём и отсюда
  const origShow = window.show;
  window.show = function (id) {
    if (!MP.remote && MP.peer && id === "start") {
      sendMsg({ t: "go", n: "start", d: window._doorNum });
    }
    return origShow.apply(this, arguments);
  };

  /* ================= Глава 2: синхронизация ================= */
  // Оригинальные методы запоминаем до подмены
  let orig = null;

  function hostPhase(p) {
    const c = C();
    if (!c.active) return c.start(p);
    if (p === c.phase) return;
    if (/^loop[1-4]$/.test(p)) return c.setupLoop(+p.slice(4));
    if (p === "hunt") return c.startHunt();
    if (p === "epilogue") return c.startEpilogue();
    if (p === "intro") return c.start("intro");
    if (p === "morning") {
      if (c.phase === "epilogue" && c.step === "dad_home") c.sleepToMorning();
    }
  }

  // Хост выполняет запросы гостя
  function hostRequest(m) {
    const c = C();
    if (!c) return;
    if (m.op === "phase") {
      MP.morningDone = false;
      hostPhase(m.p);
      return;
    }
    if (m.op === "door" && m.id) {
      c.doors[m.id] = true;
      c.renderRoom();
    }
  }

  // Улики гостя: добавляем только для текущей фазы хоста
  function hostMergeFound(m) {
    const c = C();
    if (!c || !m.found) return;
    const prefix = c.phase + ":";
    Object.keys(m.found).forEach(k => {
      if (m.found[k] && k.indexOf(prefix) === 0) c.found[k] = true;
    });
  }

  // Гость получает снимок мира от хоста и подстраивает свою копию
  function applySnapshot(s) {
    const c = C();
    if (!c || !s.active) return;
    MP.applying = true;
    try {
      if (!c.active || s.ph !== c.phase) {
        if (s.ph === "intro") orig.start.call(c, "intro");
        else if (/^loop[1-4]$/.test(s.ph)) orig.setupLoop.call(c, +s.ph.slice(4));
        else if (s.ph === "hunt") {
          orig.startHunt.call(c);
          // таймеры хода ведёт хост, локальные не нужны
          clearInterval(c.huntTimer);
          clearInterval(c.monsterTick);
          c.huntTimer = c.monsterTick = null;
        } else if (s.ph === "epilogue") orig.startEpilogue.call(c);
      }

      if (s.ph === "epilogue") {
        if (s.step === "morning" && c.step !== "morning" && !MP.morningDone) {
          MP.morningDone = true;
          orig.sleepToMorning.call(c);
        } else if (s.step !== "morning") {
          c.step = s.step;
        }
      }

      c.time = s.time;
      c.doors = s.doors || {};
      if (s.doorsOpen) c.doorsOpen = s.doorsOpen;
      if (s.found) Object.keys(s.found).forEach(k => { if (s.found[k]) c.found[k] = true; });
      c.monster = s.monster || c.monster;
      c.huntSecondsLeft = s.hunt;
      c.poltergeistItems = s.polt;
      c.setTime(s.time, false);

      if (c.phase === "hunt" && c.monster) {
        Walk.setTask(
          `ПРЯЧЬСЯ! Монстр: ${ROOM_NAMES[c.monster.room] || "квартира"}, ещё ${c.monster.left}с • До развязки: ${Math.max(0, c.huntSecondsLeft)}с`,
          true
        );
      }
    } catch (e) {
      // снимок не применился: ждём следующий
    } finally {
      MP.applying = false;
    }
    c.renderRoom();
  }

  function setupCh2() {
    const c = C();
    if (!c || orig) return;
    orig = {
      start: c.start,
      setupLoop: c.setupLoop,
      startHunt: c.startHunt,
      startEpilogue: c.startEpilogue,
      sleepToMorning: c.sleepToMorning,
      openDoor: c.openDoor
    };

    c.start = function (phase) {
      if (guestOnly()) return sendMsg({ t: "c2req", op: "phase", p: phase || "intro" });
      return orig.start.apply(this, arguments);
    };
    c.setupLoop = function (n) {
      if (guestOnly()) return sendMsg({ t: "c2req", op: "phase", p: "loop" + n });
      return orig.setupLoop.apply(this, arguments);
    };
    c.startHunt = function () {
      if (guestOnly()) return sendMsg({ t: "c2req", op: "phase", p: "hunt" });
      return orig.startHunt.apply(this, arguments);
    };
    c.startEpilogue = function () {
      if (guestOnly()) return sendMsg({ t: "c2req", op: "phase", p: "epilogue" });
      return orig.startEpilogue.apply(this, arguments);
    };
    c.sleepToMorning = function () {
      if (guestOnly()) return sendMsg({ t: "c2req", op: "phase", p: "morning" });
      return orig.sleepToMorning.apply(this, arguments);
    };
    c.openDoor = function (id) {
      const before = this.doors[id];
      const r = orig.openDoor.apply(this, arguments);
      if (coop() && isGuest() && !MP.applying && this.doors[id] && !before) {
        sendMsg({ t: "c2req", op: "door", id });
      }
      return r;
    };

    // Хост рассылает снимок мира и следит, не настиг ли монстр гостя
    setInterval(() => {
      const cc = C();
      if (!cc || !coop() || MP.role !== "host" || !cc.active) return;
      sendMsg({
        t: "c2s", active: true, ph: cc.phase, step: cc.step, time: cc.time,
        doors: cc.doors, doorsOpen: cc.doorsOpen, found: cc.found,
        monster: cc.monster, hunt: cc.huntSecondsLeft, polt: cc.poltergeistItems
      });
      const inMonsterRoom = cc.phase === "hunt" && cc.monster && MP.peerScene === "ch2"
        && MP.peerRoom === cc.monster.room && !MP.peerHide;
      if (inMonsterRoom) {
        if (MP.caughtFor !== cc.monster.room) {
          MP.caughtFor = cc.monster.room;
          sendMsg({ t: "c2", op: "caught" });
        }
      } else if (MP.caughtFor && (!cc.monster || MP.caughtFor !== cc.monster.room)) {
        MP.caughtFor = null;
      }
    }, 400);

    // Гость присылает найденные улики хосту
    setInterval(() => {
      const cc = C();
      if (!cc || !cc.active || !coop() || !isGuest()) return;
      sendMsg({ t: "c2up", found: cc.found });
    }, 400);
  }

  /* ---------- Интерфейс: кнопка и панель ---------- */
  function updateBtn() {
    const b = $m("mpBtn");
    if (!b) return;
    b.textContent = MP.inRoom ? "🌐 Комната " + MP.code : "🌐 " + (MP.nick || "Онлайн");
    b.style.borderColor = MP.inRoom ? "#e62929" : "";
  }

  function renderRoomBox() {
    const box = $m("mpRoomBox");
    if (!box) return;
    if (!MP.inRoom) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `
      <div style="font-size:0.9rem;color:var(--dim)">Код комнаты (передай другу):</div>
      <div style="font-family:monospace;font-size:2rem;letter-spacing:6px;color:#fff">${MP.code}</div>
      <div style="font-size:0.82rem;color:var(--dim);max-width:300px">
        Кооп-режим: главы 1 и 2 синхронизированы, второй игрок виден в квартире.
      </div>`;
    if (MP.role === "host" && !MP.peer) setStatus("Ждём второго игрока...");
  }

  function openPanel() {
    if (document.querySelector(".game .mp-ov")) return;
    const ov = document.createElement("div");
    ov.className = "ov mp-ov";
    ov.style.zIndex = 95;
    ov.style.animation = "none";
    ov.innerHTML = `
      <div class="menu-title" style="font-size:2rem">Онлайн-кооп</div>
      <div id="mpRoomBox" style="display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center"></div>
      <div id="mpStatus" class="menu-sub" style="min-height:1.2em"></div>
      <div class="menu-btns" id="mpBtns">
        <button class="ovb" id="mpNick">Сменить ник${MP.nick ? " (" + MP.nick + ")" : ""}</button>
        <button class="ovb" id="mpCreate">Создать комнату</button>
        <input id="mpCode" maxlength="4" placeholder="Код комнаты" style="font:inherit;text-align:center;letter-spacing:4px;text-transform:uppercase;padding:8px;background:#181a1f;color:var(--ink);border:1px solid #383b42;border-radius:5px;">
        <button class="ovb" id="mpJoin">Войти по коду</button>
        <button class="ovb" id="mpLeave">Выйти из комнаты</button>
        <button class="ovb" id="mpClose">Закрыть</button>
      </div>`;
    document.querySelector(".game").appendChild(ov);

    ov.querySelector("#mpCreate").onclick = () => {
      if (window.Sfx) Sfx.click();
      if (MP.inRoom) return;
      setStatus("Создаём комнату...");
      connect(() => sendMsg({ t: "create", nick: MP.nick }));
    };
    ov.querySelector("#mpJoin").onclick = () => {
      if (window.Sfx) Sfx.click();
      const code = ov.querySelector("#mpCode").value.trim().toUpperCase();
      if (code.length !== 4) return setStatus("Код состоит из 4 символов", "#ffb3b3");
      if (MP.inRoom) return setStatus("Сначала выйдите из текущей комнаты", "#ffb3b3");
      setStatus("Подключаемся...");
      connect(() => sendMsg({ t: "join", code, nick: MP.nick }));
    };
    ov.querySelector("#mpLeave").onclick = () => {
      if (MP.ws) MP.ws.close();
      MP.inRoom = false;
      MP.peer = false;
      MP.code = null;
      MP.peerScene = null;
      MP.peerRoom = null;
      hideGhost();
      renderRoomBox();
      setStatus("Вы вышли из комнаты");
      updateBtn();
    };
    ov.querySelector("#mpNick").onclick = () => askNick(true);
    ov.querySelector("#mpClose").onclick = () => ov.remove();
    renderRoomBox();
    if (MP.inRoom) setStatus(MP.peer ? "Второй игрок подключён" : "Ждём второго игрока...", MP.peer ? "#9be89b" : "");
  }

  function addButton() {
    const game = document.querySelector(".game");
    if (!game || $m("mpBtn")) return;
    const b = document.createElement("button");
    b.id = "mpBtn";
    b.className = "snd";
    b.style.position = "absolute";
    b.style.right = "14px";
    b.style.bottom = "14px";
    b.style.zIndex = "60";
    b.style.background = "rgba(20,22,26,0.82)";
    b.style.fontSize = "0.82rem";
    b.onclick = () => openPanel();
    game.appendChild(b);
    updateBtn();
  }

  /* ---------- Ник и сохранения на сервере ---------- */
  const NICK_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;
  try { MP.nick = localStorage.getItem("kcNick"); } catch (e) {}
  window.kcNick = MP.nick;

  // Сохранение уходит на сервер под ником (см. Store.flush в index.html)
  window.kcServerPut = (nick, data) => fetch("/api/save?nick=" + encodeURIComponent(nick), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  function loadSaveFor(nick) {
    fetch("/api/save?nick=" + encodeURIComponent(nick))
      .then(r => r.json())
      .then(d => { if (window.kcStoreMerge) window.kcStoreMerge(d); })
      .catch(() => {});
  }

  function askNick(isChange) {
    if (document.querySelector(".game .nick-ov")) return;
    const ov = document.createElement("div");
    ov.className = "ov nick-ov";
    ov.style.zIndex = isChange ? 96 : 58;
    ov.style.animation = "none";
    ov.innerHTML = `
      <div class="menu-title" style="font-size:2rem">${isChange ? "Сменить ник" : "Введите ник"}</div>
      <div class="menu-sub">По нику сохраняется ваш прогресс. Второй игрок увидит ваш ник в кооп-комнате.</div>
      <input id="nickIn" maxlength="16" value="${MP.nick || ""}" placeholder="2–16 символов" style="font:inherit;text-align:center;padding:8px;width:min(260px,80%);background:#181a1f;color:var(--ink);border:1px solid #383b42;border-radius:5px;">
      <div id="nickErr" style="color:#ffb3b3;font-size:0.85rem;min-height:1.2em"></div>
      <div class="menu-btns">
        <button class="ovb" id="nickOk">${isChange ? "Сохранить" : "Продолжить"}</button>
        ${isChange ? '<button class="ovb" id="nickCancel">Отмена</button>' : ""}
      </div>`;
    document.querySelector(".game").appendChild(ov);

    const input = ov.querySelector("#nickIn");
    const err = ov.querySelector("#nickErr");
    const ok = () => {
      const n = input.value.trim().replace(/\s+/g, " ");
      if (!NICK_RE.test(n)) {
        err.textContent = "Ник: 2–16 символов, буквы, цифры, _ и -";
        return;
      }
      if (window.Sfx) Sfx.click();
      const prev = MP.nick;
      try { localStorage.setItem("kcNick", n); } catch (e) {}
      MP.nick = n;
      window.kcNick = n;
      ov.remove();
      // Смена на другой ник перезагружает страницу, чтобы прогресс двух игроков не смешался
      if (prev && prev !== n) { location.reload(); return; }
      loadSaveFor(n);
      updateBtn();
    };
    ov.querySelector("#nickOk").onclick = ok;
    input.onkeydown = e => { if (e.key === "Enter") ok(); };
    input.focus();
    const cancel = ov.querySelector("#nickCancel");
    if (cancel) cancel.onclick = () => ov.remove();
  }

  addButton();
  setupCh2();

  // Ник спрашиваем только на сервере: при открытии файлом сохранения локальные
  if (/^https?:$/.test(location.protocol)) {
    if (MP.nick) loadSaveFor(MP.nick);
    else setTimeout(() => askNick(false), 300);
  }
})();
