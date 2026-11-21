/* Кооператив для «Красные цифры»: 2 игрока, синхронизация переходов между сценами
   главы 1 и позиции второго игрока. Глава 2 в этой версии идёт локально. */
(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const MP = { ws: null, code: null, role: null, peer: false, remote: false, lastSent: "" };
  const $m = id => document.getElementById(id);

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
      renderRoom();
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
        setStatus("Второй игрок подключён", "#9be89b");
      } else if (m.state === "left") {
        MP.peer = false;
        MP.inRoom = false;
        MP.code = null;
        hideGhost();
        setStatus("Второй игрок вышел, комната закрыта", "#ffb3b3");
        updateBtn();
      }
      renderRoom();
      return;
    }
    if (m.t === "go") {
      applyRemoteGo(m.n, m.d);
      return;
    }
    if (m.t === "pos") {
      showGhost(m);
    }
  }

  // Переход, который пришёл от второго игрока
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
    const g = ensureGhost();
    if (!g) return;
    const cur = window._currentSceneId;
    if (!MP.peer || !p.s || p.s !== cur || (window.Ch2 && window.Ch2.active)) {
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
    if (!MP.peer || !window.Walk || Walk.hidden || (window.Ch2 && Ch2.active)) return;
    const s = window._currentSceneId;
    if (!s) return;
    const payload = { t: "pos", s, x: Math.round(Walk.x * 10) / 10, y: Math.round(Walk.y * 10) / 10, f: Walk.face };
    const key = JSON.stringify(payload);
    if (key === MP.lastSent) return;
    MP.lastSent = key;
    sendMsg(payload);
  }, 100);

  /* ---------- Перехват переходов: go() шлёт собеседнику ---------- */
  const origGo = window.go;
  window.go = function (n) {
    if (!MP.remote && MP.peer && n && n !== "menu") {
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

  /* ---------- Интерфейс: кнопка и панель ---------- */
  function updateBtn() {
    const b = $m("mpBtn");
    if (!b) return;
    b.textContent = MP.inRoom ? "🌐 Комната " + MP.code : "🌐 Онлайн";
    b.style.borderColor = MP.inRoom ? "#e62929" : "";
  }

  function renderRoom() {
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
        Кооп-режим синхронизирует переходы между комнатами и показывает второго игрока.
        Глава 2 пока проходится в каждой копии отдельно.
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
        <button class="ovb" id="mpCreate">Создать комнату</button>
        <input id="mpCode" maxlength="4" placeholder="Код комнаты" style="font:inherit;text-align:center;letter-spacing:4px;text-transform:uppercase;padding:8px;background:#181a1f;color:var(--ink);border:1px solid #383b42;border-radius:5px;">
        <button class="ovb" id="mpJoin">Войти по коду</button>
        <button class="ovb" id="mpLeave">Выйти из комнаты</button>
        <button class="ovb" id="mpClose">Закрыть</button>
      </div>`;
    document.querySelector(".game").appendChild(ov);

    const create = () => connect(() => sendMsg({ t: "create" }));
    ov.querySelector("#mpCreate").onclick = () => {
      if (window.Sfx) Sfx.click();
      if (MP.inRoom) return;
      setStatus("Создаём комнату...");
      create();
    };
    ov.querySelector("#mpJoin").onclick = () => {
      if (window.Sfx) Sfx.click();
      const code = ov.querySelector("#mpCode").value.trim().toUpperCase();
      if (code.length !== 4) return setStatus("Код состоит из 4 символов", "#ffb3b3");
      if (MP.inRoom) return setStatus("Сначала выйдите из текущей комнаты", "#ffb3b3");
      setStatus("Подключаемся...");
      connect(() => sendMsg({ t: "join", code }));
    };
    ov.querySelector("#mpLeave").onclick = () => {
      if (MP.ws) MP.ws.close();
      MP.inRoom = false;
      MP.peer = false;
      MP.code = null;
      hideGhost();
      renderRoom();
      setStatus("Вы вышли из комнаты");
      updateBtn();
    };
    ov.querySelector("#mpClose").onclick = () => ov.remove();
    renderRoom();
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

  addButton();
})();
