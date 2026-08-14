const desktop = document.querySelector('#desktop');
const phone = document.querySelector('#phone');
const qr = document.querySelector('#qr');
const uploadUrl = document.querySelector('#uploadUrl');
const receiveDir = document.querySelector('#receiveDir');
const copyBtn = document.querySelector('#copyBtn');
const fileInput = document.querySelector('#fileInput');
const statusBox = document.querySelector('#status');
const list = document.querySelector('#list');

const isUploadPage = location.pathname === '/upload';

if (isUploadPage) {
  desktop.hidden = true;
  phone.hidden = false;
} else {
  fetch('/api/info')
    .then(response => response.json())
    .then(info => {
      uploadUrl.value = info.uploadUrl;
      receiveDir.textContent = info.receiveDir;

      const image = document.createElement('img');
      image.alt = '上传地址二维码';
      image.width = 360;
      image.height = 360;
      image.src = `/api/qr?data=${encodeURIComponent(info.uploadUrl)}&t=${Date.now()}`;
      qr.replaceChildren(image);
    })
    .catch(() => {
      qr.textContent = '二维码生成失败';
    });
}

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
    const response = await fetch('/api/upload', { method: 'POST', body: form });
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

// ---------- 手机端：发送文本 ----------
const textInput = document.querySelector('#textInput');
const sendTextBtn = document.querySelector('#sendTextBtn');
const textStatus = document.querySelector('#textStatus');

sendTextBtn?.addEventListener('click', async () => {
  const text = (textInput?.value || '').trim();
  if (!text) {
    textStatus.textContent = '请输入文本';
    return;
  }
  textStatus.textContent = '正在发送…';
  try {
    const response = await fetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || '发送失败');
    textStatus.textContent = '已发送';
    textInput.value = '';
  } catch (error) {
    textStatus.textContent = error.message || '发送失败';
  }
});

// ---------- 电脑端：轮询收到的文本 ----------
const textList = document.querySelector('#textList');
if (textList) {
  let lastCount = -1;
  async function refreshTexts() {
    try {
      const response = await fetch('/api/texts');
      const data = await response.json();
      const items = data.items || [];
      if (items.length === lastCount) return; // 无变化则不重绘
      lastCount = items.length;
      if (!items.length) {
        textList.innerHTML = '<p class="empty">还没有收到文本。</p>';
        return;
      }
      textList.innerHTML = '';
      items.forEach(it => {
        const card = document.createElement('div');
        card.className = 'text-item';
        const head = document.createElement('div');
        head.className = 'text-head';
        head.textContent = it.name;
        const body = document.createElement('pre');
        body.className = 'text-body';
        body.textContent = it.content;
        card.appendChild(head);
        card.appendChild(body);
        textList.appendChild(card);
      });
    } catch {}
  }
  refreshTexts();
  setInterval(refreshTexts, 2000);
}
