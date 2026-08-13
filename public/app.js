const desktop = document.querySelector('#desktop');
const phone = document.querySelector('#phone');
const gate = document.querySelector('#gate');
const qr = document.querySelector('#qr');
const uploadUrl = document.querySelector('#uploadUrl');
const receiveDir = document.querySelector('#receiveDir');
const copyBtn = document.querySelector('#copyBtn');
const fileInput = document.querySelector('#fileInput');
const statusBox = document.querySelector('#status');
const list = document.querySelector('#list');
const pwInput = document.querySelector('#pwInput');
const pwBtn = document.querySelector('#pwBtn');
const pwErr = document.querySelector('#pwErr');

// 读取地址栏中的访问口令（如 ?pw=xxx），并透传到所有后端请求。
const pw = new URLSearchParams(location.search).get('pw') || '';
function api(path) {
  if (!pw) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}pw=${encodeURIComponent(pw)}`;
}

function showGate(message) {
  if (gate) {
    gate.hidden = false;
    if (desktop) desktop.hidden = true;
    if (phone) phone.hidden = true;
    if (message && pwErr) pwErr.textContent = message;
    pwInput?.focus();
  }
}

function enterWithPassword() {
  const value = (pwInput?.value || '').trim();
  if (!value) {
    if (pwErr) pwErr.textContent = '请输入访问口令。';
    return;
  }
  const params = new URLSearchParams(location.search);
  params.set('pw', value);
  location.href = `${location.pathname}?${params.toString()}`;
}
pwBtn?.addEventListener('click', enterWithPassword);
pwInput?.addEventListener('keydown', e => { if (e.key === 'Enter') enterWithPassword(); });

const isUploadPage = location.pathname === '/upload';

// 先用 /api/info 验证口令（桌面页用它生成二维码，手机页用它确认可上传）。
fetch(api('/api/info'))
  .then(async response => {
    if (response.status === 401) {
      showGate('访问口令错误或未提供。');
      return null;
    }
    if (!response.ok) throw new Error('服务异常');
    return response.json();
  })
  .then(info => {
    if (!info) return;

    if (isUploadPage) {
      if (desktop) desktop.hidden = true;
      if (phone) phone.hidden = false;
      return;
    }

    uploadUrl.value = info.uploadUrl;
    receiveDir.textContent = info.receiveDir;

    const image = document.createElement('img');
    image.alt = '上传地址二维码';
    image.width = 360;
    image.height = 360;
    image.src = api(`/api/qr?data=${encodeURIComponent(info.uploadUrl)}`) + `&t=${Date.now()}`;
    qr.replaceChildren(image);
  })
  .catch(() => {
    if (gate && !gate.hidden) return;
    qr.textContent = '无法连接服务';
  });

copyBtn?.addEventListener('click', async () => {
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(uploadUrl.value);
      copied = true;
    }
  } catch {}

  if (!copied) {
    uploadUrl.focus();
    uploadUrl.select();
    uploadUrl.setSelectionRange(0, uploadUrl.value.length);
    copied = document.execCommand('copy');
  }

  copyBtn.textContent = copied ? '已复制' : '请长按复制';
  setTimeout(() => copyBtn.textContent = '复制', 1400);
});

fileInput?.addEventListener('change', async () => {
  const files = [...fileInput.files];
  if (!files.length) return;

  const form = new FormData();
  files.forEach(file => form.append('files', file, file.name));
  statusBox.textContent = `正在发送 ${files.length} 个文件...`;

  try {
    const response = await fetch(api('/api/upload'), { method: 'POST', body: form });
    if (response.status === 401) {
      showGate('访问口令错误或未提供。');
      return;
    }
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || '上传失败');

    statusBox.textContent = '发送完成';
    list.innerHTML = '';
    result.files.forEach(file => {
      const li = document.createElement('li');
      li.textContent = `${file.name} - ${formatSize(file.size)}`;
      list.appendChild(li);
    });
    fileInput.value = '';
  } catch (error) {
    statusBox.textContent = error.message || '发送失败';
  }
});

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
