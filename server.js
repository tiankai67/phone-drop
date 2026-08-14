import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT || 3456);
const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'received-files');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function localAddress() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function safeName(name) {
  const base = path.basename(String(name || 'file'));
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'file';
}

function uniquePath(fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(UPLOAD_DIR, fileName);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(UPLOAD_DIR, `${parsed.name} (${i})${parsed.ext}`);
    i += 1;
  }
  return candidate;
}

function parseMultipart(req, boundary) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024 * 1024) {
        req.destroy();
        reject(new Error('文件太大，单次最多 1GB。'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const marker = Buffer.from(`--${boundary}`);
      const files = [];
      let pos = body.indexOf(marker);

      while (pos !== -1) {
        pos += marker.length;
        if (body.slice(pos, pos + 2).toString() === '--') break;
        if (body.slice(pos, pos + 2).toString() === '\r\n') pos += 2;

        const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
        if (headerEnd === -1) break;
        const headers = body.slice(pos, headerEnd).toString('utf8');
        const nameMatch = headers.match(/filename="([^"]*)"/i);
        const next = body.indexOf(marker, headerEnd + 4);
        if (next === -1) break;

        let contentEnd = next;
        if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;

        if (nameMatch && nameMatch[1]) {
          const original = safeName(nameMatch[1]);
          const target = uniquePath(original);
          fs.writeFileSync(target, body.slice(headerEnd + 4, contentEnd));
          files.push({
            name: path.basename(target),
            size: contentEnd - (headerEnd + 4)
          });
        }
        pos = next;
      }
      resolve(files);
    });
    req.on('error', reject);
  });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new Error('内容过长。'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/info') {
    const host = localAddress();
    return send(res, 200, JSON.stringify({
      uploadUrl: `http://${host}:${PORT}/upload`,
      receiveDir: UPLOAD_DIR
    }), 'application/json; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/qr') {
    const data = url.searchParams.get('data') || `http://${localAddress()}:${PORT}/upload`;
    const png = await QRCode.toBuffer(data, {
      type: 'png',
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#16202a', light: '#ffffff' }
    });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store'
    });
    return res.end(png);
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return send(res, 400, JSON.stringify({ error: '没有收到文件。' }), 'application/json; charset=utf-8');

    try {
      const files = await parseMultipart(req, match[1] || match[2]);
      return send(res, 200, JSON.stringify({ ok: true, files }), 'application/json; charset=utf-8');
    } catch (error) {
      return send(res, 500, JSON.stringify({ error: error.message }), 'application/json; charset=utf-8');
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/text') {
    try {
      const raw = await readBody(req);
      let text = '';
      try { text = (JSON.parse(raw) || {}).text || ''; } catch { text = raw; }
      text = String(text).slice(0, 100000);
      if (!text.trim()) {
        return send(res, 400, JSON.stringify({ error: '文本为空。' }), 'application/json; charset=utf-8');
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = uniquePath(`note_${stamp}.txt`);
      fs.writeFileSync(target, text, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, name: path.basename(target) }), 'application/json; charset=utf-8');
    } catch (error) {
      return send(res, 500, JSON.stringify({ error: error.message }), 'application/json; charset=utf-8');
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/texts') {
    try {
      const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.toLowerCase().endsWith('.txt'));
      const items = files.map(f => {
        const p = path.join(UPLOAD_DIR, f);
        const stat = fs.statSync(p);
        let content = '';
        try { content = fs.readFileSync(p, 'utf8'); } catch {}
        return { name: f, content, mtime: stat.mtimeMs };
      }).sort((a, b) => b.mtime - a.mtime).slice(0, 50);
      return send(res, 200, JSON.stringify({ items }), 'application/json; charset=utf-8');
    } catch (error) {
      return send(res, 500, JSON.stringify({ error: error.message }), 'application/json; charset=utf-8');
    }
  }

  const filePath = (url.pathname === '/' || url.pathname === '/upload') ? '/index.html' : url.pathname;
  const target = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!target.startsWith(PUBLIC_DIR) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return send(res, 404, '找不到页面');
  }

  const ext = path.extname(target).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png'
  };
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const url = `http://${localAddress()}:${PORT}`;
  console.log(`Phone Drop is running: ${url}`);
  console.log(`Files will be saved to: ${UPLOAD_DIR}`);
});
