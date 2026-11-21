// Сервер игры «Красные цифры»: отдаёт файлы из public/ и комнаты для кооп-режима (WebSocket на /ws).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const PUBLIC = path.join(__dirname, 'public');

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

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }
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
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.t === 'create') {
      if (ws.room) return;
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
      r.players.push(ws);
      ws.room = code;
      ws.role = 'guest';
      send(ws, { t: 'joined', code, role: 'guest' });
      send(r.players[0], { t: 'peer', state: 'joined' });
      send(ws, { t: 'peer', state: 'joined' });
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
  console.log(`Red Digits listening on port ${PORT}`);
});
