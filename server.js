// Сервер игры «Красные цифры»: отдаёт файлы из public/, хранит сохранения по нику
// (/api/save) и комнаты для кооп-режима (WebSocket на /ws).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const PUBLIC = path.join(__dirname, 'public');
// На Render сюда монтируется постоянный диск (если он подключён). Без диска файлы
// сбрасываются при перезапуске сервиса, поэтому DATA_DIR задаётся переменной окружения.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
fs.mkdirSync(SAVES_DIR, { recursive: true });

const MAX_SAVE_BYTES = 16 * 1024;
const NICK_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

// Подключаем mp.js к index.html на лету, чтобы не править саму игру
let indexCache = null;
function getIndex() {
  if (indexCache === null) {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    indexCache = html.replace('</body>', '<script src="/mp.js"></script>\n</body>');
  }
  return indexCache;
}

/* ---------- Сохранения по нику ---------- */
function normNick(raw) {
  const n = String(raw || '').trim().replace(/\s+/g, ' ');
  return NICK_RE.test(n) ? n : null;
}

// Имя файла из хеша ника: безопасно для любых символов
function saveFile(nick) {
  const h = crypto.createHash('sha256').update(nick.toLowerCase()).digest('hex');
  return path.join(SAVES_DIR, h + '.json');
}

// Сохраняем только известные поля, чтобы в файл не попал мусор
function cleanSave(d) {
  const out = {};
  if (typeof d.ch1Done === 'boolean') out.ch1Done = d.ch1Done;
  if (typeof d.ch2Done === 'boolean') out.ch2Done = d.ch2Done;
  if (d.ch2Stage === null || (typeof d.ch2Stage === 'string' && d.ch2Stage.length < 32)) out.ch2Stage = d.ch2Stage;
  return out;
}

function readBody(req, limit, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > limit) {
      req.destroy();
      return cb(new Error('too large'));
    }
    chunks.push(c);
  });
  req.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  req.on('error', cb);
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function handleSave(req, res, url) {
  const nick = normNick(url.searchParams.get('nick'));
  if (!nick) return json(res, 400, { error: 'Некорректный ник: 2–16 символов, буквы, цифры, _ и -' });

  if (req.method === 'GET') {
    fs.readFile(saveFile(nick), 'utf8', (err, data) => {
      if (err) return json(res, 200, {});
      try { json(res, 200, JSON.parse(data)); } catch (e) { json(res, 200, {}); }
    });
    return;
  }

  if (req.method === 'PUT') {
    readBody(req, MAX_SAVE_BYTES, (err, body) => {
      if (err) return json(res, 413, { error: 'Сохранение слишком большое' });
      let d;
      try { d = JSON.parse(body); } catch (e) { return json(res, 400, { error: 'Нужен JSON' }); }
      const clean = cleanSave(d || {});
      const file = saveFile(nick);
      // Пишем во временный файл и переименовываем, чтобы не испортить сохранение при сбое
      const tmp = file + '.tmp';
      fs.writeFile(tmp, JSON.stringify(clean), err2 => {
        if (err2) return json(res, 500, { error: 'Не удалось записать' });
        fs.rename(tmp, file, err3 => {
          if (err3) return json(res, 500, { error: 'Не удалось записать' });
          json(res, 200, { ok: true });
        });
      });
    });
    return;
  }

  res.writeHead(405);
  res.end();
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  const urlPath = decodeURIComponent(url.pathname);

  if (urlPath === '/api/save') return handleSave(req, res, url);

  if (urlPath === '/' || urlPath === '/index.html') {
    try {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return res.end(getIndex());
    } catch (e) {
      res.writeHead(500);
      return res.end('index.html not found in public/');
    }
  }
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

// ----- комнаты: максимум 2 игрока, хост ведёт сюжет -----
const rooms = new Map(); // code -> { players: [ws, ws] }
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function leaveRoom(ws) {
  if (!ws.room) return;
  const r = rooms.get(ws.room);
  const code = ws.room;
  ws.room = null;
  if (!r) return;
  // Если кто-то вышел, комната закрывается, второму сообщаем
  rooms.delete(code);
  r.players.forEach(p => {
    if (p !== ws) {
      p.room = null;
      send(p, { t: 'peer', state: 'left' });
    }
  });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', ws => {
  ws.room = null;
  ws.role = null;
  ws.nick = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.t === 'create') {
      if (ws.room) return;
      ws.nick = normNick(m.nick) || 'Игрок';
      let code;
      do { code = genCode(); } while (rooms.has(code));
      rooms.set(code, { players: [ws] });
      ws.room = code;
      ws.role = 'host';
      return send(ws, { t: 'joined', code, role: 'host' });
    }

    if (m.t === 'join') {
      if (ws.room) return;
      const code = String(m.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'error', msg: 'Комната не найдена' });
      if (r.players.length >= 2) return send(ws, { t: 'error', msg: 'Комната заполнена' });
      ws.nick = normNick(m.nick) || 'Игрок';
      const host = r.players[0];
      r.players.push(ws);
      ws.room = code;
      ws.role = 'guest';
      send(ws, { t: 'joined', code, role: 'guest' });
      // Каждый получает ник собеседника
      send(host, { t: 'peer', state: 'joined', nick: ws.nick });
      send(ws, { t: 'peer', state: 'joined', nick: host.nick });
      return;
    }

    // Все остальные сообщения просто пересылаем второму игроку комнаты
    if (!ws.room) return;
    const r = rooms.get(ws.room);
    if (!r) return;
    const other = r.players.find(p => p !== ws);
    if (other) send(other, m);
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

// Пинг, чтобы хостинг не рвал простаивающие соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Red Digits listening on port ${PORT}, saves in ${SAVES_DIR}`);
});
