import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT || 3456);
const PASSWORD = process.env.PASSWORD || '';
const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'received-files');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 公网部署时，请求经过反向代理（Render/Railway 等），Host 与协议来自请求头。
function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// 可选访问口令：通过 URL 参数 ?pw= 或请求头 x-password 传递。
function authorized(req, url) {
  if (!PASSWORD) return true;
  const viaQuery = url.searchParams.get('pw');
  const viaHeader = req.headers['x-password'];
  return viaQuery === PASSWORD || viaHeader === PASSWORD;
}

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // 受保护接口：需要口令（若已配置）
  const protectedApi = (pathname) => req.method === 'GET' && url.pathname === pathname;
  if (protectedApi('/api/info') || protectedApi('/api/qr') ||
      (req.method === 'POST' && url.pathname === '/api/upload')) {
    if (!authorized(req, url)) {
      return send(res, 401, JSON.stringify({ error: '需要访问口令。' }), 'application/json; charset=utf-8');
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/info') {
    const base = publicBase(req);
    const uploadUrl = PASSWORD ? `${base}/upload?pw=${encodeURIComponent(PASSWORD)}` : `${base}/upload`;
    return send(res, 200, JSON.stringify({
      uploadUrl,
      receiveDir: UPLOAD_DIR
    }), 'application/json; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/qr') {
    const base = publicBase(req);
    const data = url.searchParams.get('data') || (PASSWORD ? `${base}/upload?pw=${encodeURIComponent(PASSWORD)}` : `${base}/upload`);
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
  if (PASSWORD) console.log('Access password is ENABLED.');
});
