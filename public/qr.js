function QRCodeSvg(text) {
  const version = 4;
  const size = 17 + 4 * version;
  const dataCodewords = 64;
  const ecCodewords = 18;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > 62) throw new Error('URL too long for this QR encoder');

  const bits = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, 8);
  bytes.forEach(byte => pushBits(bits, byte, 8));
  pushBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bitsToByte(bits.slice(i, i + 8)));
  for (let pad = 0; data.length < dataCodewords; pad ^= 1) data.push(pad ? 0x11 : 0xec);

  const blocks = [data.slice(0, 32), data.slice(32, 64)];
  const ecs = blocks.map(block => reedSolomon(block, ecCodewords));
  const codewords = [];
  for (let i = 0; i < 32; i++) blocks.forEach(block => codewords.push(block[i]));
  for (let i = 0; i < ecCodewords; i++) ecs.forEach(block => codewords.push(block[i]));

  drawFunctionPatterns();
  drawCodewords(codewords);

  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const trial = modules.map(row => row.slice());
    applyMask(trial, mask);
    drawFormatBits(trial, mask);
    const score = penalty(trial);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }
  applyMask(modules, bestMask);
  drawFormatBits(modules, bestMask);

  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${x},${y}h1v1h-1z`;
    }
  }
  return `<svg viewBox="-4 -4 ${size + 8} ${size + 8}" role="img" aria-label="上传地址二维码" xmlns="http://www.w3.org/2000/svg"><rect x="-4" y="-4" width="${size + 8}" height="${size + 8}" fill="#fff"/><path d="${path}" fill="#16202a"/></svg>`;

  function set(x, y, dark = true, isReserved = true) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    if (isReserved) reserved[y][x] = true;
  }

  function reserve(x, y) {
    if (x >= 0 && y >= 0 && x < size && y < size) reserved[y][x] = true;
  }

  function drawFunctionPatterns() {
    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);

    for (let i = 8; i < size - 8; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }

    alignment(26, 26);
    set(8, 4 * version + 9, true);

    for (let i = 0; i < 9; i++) {
      reserve(8, i);
      reserve(i, 8);
      reserve(size - 1 - i, 8);
      reserve(8, size - 1 - i);
    }
  }

  function finder(x, y) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(xx, yy, dark);
      }
    }
  }

  function alignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawCodewords(words) {
    const stream = [];
    words.forEach(word => pushBits(stream, word, 8));
    let i = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let dx = 0; dx < 2; dx++) {
          const x = right - dx;
          if (!reserved[y][x]) modules[y][x] = Boolean(stream[i++]);
        }
      }
      upward = !upward;
    }
  }

  function applyMask(grid, mask) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && maskBit(mask, x, y)) grid[y][x] = !grid[y][x];
      }
    }
  }

  function drawFormatBits(grid, mask) {
    const format = formatBits(mask);
    for (let i = 0; i < 15; i++) {
      const bit = Boolean((format >> i) & 1);
      const a = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]][i];
      const b = [[8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4], [8, size - 5], [8, size - 6], [8, size - 7], [size - 8, 8], [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8], [size - 3, 8], [size - 2, 8], [size - 1, 8]][i];
      grid[a[1]][a[0]] = bit;
      grid[b[1]][b[0]] = bit;
    }
  }
}

function pushBits(bits, value, count) {
  for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function bitsToByte(bits) {
  return bits.reduce((n, bit) => (n << 1) | bit, 0);
}

function maskBit(mask, x, y) {
  return [
    (x + y) % 2 === 0,
    y % 2 === 0,
    x % 3 === 0,
    (x + y) % 3 === 0,
    (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    ((x * y) % 2) + ((x * y) % 3) === 0,
    (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ][mask];
}

function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  let bits = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((bits >>> i) & 1) bits ^= 0x537 << (i - 10);
  }
  return (((data << 10) | bits) ^ 0x5412) & 0x7fff;
}

function reedSolomon(data, degree) {
  const gen = rsGenerator(degree);
  const result = Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(gen[i], factor);
  }
  return result;
}

function rsGenerator(degree) {
  let poly = Array(degree).fill(0);
  poly[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      poly[j] = gfMul(poly[j], root);
      if (j + 1 < degree) poly[j] ^= poly[j + 1];
    }
    root = gfMul(root, 2);
  }
  return poly;
}

function gfMul(x, y) {
  let z = 0;
  for (let i = 0; i < 8; i++) {
    if ((y & 1) !== 0) z ^= x;
    y >>>= 1;
    x = (x << 1) ^ ((x >>> 7) * 0x11d);
  }
  return z & 0xff;
}

function penalty(grid) {
  const size = grid.length;
  let score = 0;

  for (let y = 0; y < size; y++) score += linePenalty(grid[y]);
  for (let x = 0; x < size; x++) score += linePenalty(grid.map(row => row[x]));

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = grid[y][x];
      if (grid[y][x + 1] === c && grid[y + 1][x] === c && grid[y + 1][x + 1] === c) score += 3;
    }
  }

  const pattern = '10111010000';
  const reverse = '00001011101';
  for (let y = 0; y < size; y++) score += patternPenalty(grid[y], pattern, reverse);
  for (let x = 0; x < size; x++) score += patternPenalty(grid.map(row => row[x]), pattern, reverse);

  const dark = grid.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

function linePenalty(line) {
  let score = 0;
  let runColor = line[0];
  let run = 1;
  for (let i = 1; i < line.length; i++) {
    if (line[i] === runColor) {
      run += 1;
      if (run === 5) score += 3;
      else if (run > 5) score += 1;
    } else {
      runColor = line[i];
      run = 1;
    }
  }
  return score;
}

function patternPenalty(line, pattern, reverse) {
  const text = line.map(Boolean).map(v => v ? '1' : '0').join('');
  let score = 0;
  for (let i = 0; i <= text.length - 11; i++) {
    const part = text.slice(i, i + 11);
    if (part === pattern || part === reverse) score += 40;
  }
  return score;
}
