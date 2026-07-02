import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'public', 'assets', 'textures');

/** 计算 PNG chunk 所需 CRC32。 */
function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

/** 创建 PNG chunk。 */
function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** 将 RGBA 像素写为 PNG 文件。 */
function writePng(name, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(join(OUT_DIR, name), png);
}

/** 创建可写 RGBA 画布数据。 */
function makePixels(size) {
  return Buffer.alloc(size * size * 4);
}

/** 设置单个像素颜色。 */
function setPixel(pixels, width, x, y, r, g, b, a = 255) {
  const i = (y * width + x) * 4;
  pixels[i] = clamp(r);
  pixels[i + 1] = clamp(g);
  pixels[i + 2] = clamp(b);
  pixels[i + 3] = clamp(a);
}

/** 限制颜色数值到 0-255。 */
function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** 稳定哈希噪声，避免依赖运行时随机。 */
function noise(x, y, seed = 1) {
  const value = Math.sin((x + seed * 17.13) * 12.9898 + (y + seed * 3.71) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** 分形噪声，用于砂岩和沙地颗粒。 */
function fbm(x, y, seed = 1) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < 4; i += 1) {
    value += noise(x * frequency, y * frequency, seed + i * 11) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

/** 生成古埃及砂岩砖墙漫反射贴图。 */
function generateWallDiffuse() {
  const size = 512;
  const pixels = makePixels(size);
  const rowHeight = 54;
  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / rowHeight);
    const offset = row % 2 === 0 ? 0 : 42;
    for (let x = 0; x < size; x += 1) {
      const brickWidth = 78 + Math.floor(noise(row, Math.floor((x + offset) / 96), 4) * 36);
      const mortarX = ((x + offset) % brickWidth) < 4 || ((x + offset) % brickWidth) > brickWidth - 4;
      const mortarY = y % rowHeight < 4 || y % rowHeight > rowHeight - 4;
      const grain = fbm(x / 38, y / 38, 8);
      const chip = noise(Math.floor(x / 13), Math.floor(y / 11), 9);
      if (mortarX || mortarY) {
        setPixel(pixels, size, x, y, 73 + grain * 18, 48 + grain * 14, 26 + grain * 9);
      } else {
        const edge = mortarX || mortarY ? -18 : 0;
        setPixel(
          pixels,
          size,
          x,
          y,
          190 + grain * 62 - (chip > 0.92 ? 26 : 0) + edge,
          139 + grain * 48 - (chip > 0.92 ? 20 : 0) + edge,
          64 + grain * 30 - (chip > 0.92 ? 12 : 0),
        );
      }
    }
  }
  writePng('wall_sandstone_diffuse.png', size, size, pixels);
}

/** 生成砂岩粗糙度贴图。 */
function generateWallRoughness() {
  const size = 512;
  const pixels = makePixels(size);
  const rowHeight = 54;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mortar = y % rowHeight < 4 || y % rowHeight > rowHeight - 4 || x % 92 < 4 || x % 92 > 88;
      const grain = fbm(x / 28, y / 28, 22);
      const v = mortar ? 105 + grain * 54 : 178 + grain * 58;
      setPixel(pixels, size, x, y, v, v, v);
    }
  }
  writePng('wall_sandstone_roughness.png', size, size, pixels);
}

/** 生成浅色无缝沙地贴图。 */
function generateFloorDiffuse() {
  const size = 512;
  const pixels = makePixels(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ripple = Math.sin((x + Math.sin(y / 34) * 18) / 18) * 7;
      const grain = fbm(x / 44, y / 44, 41) * 30;
      const speck = noise(x, y, 99) > 0.985 ? -24 : 0;
      setPixel(pixels, size, x, y, 221 + grain + ripple + speck, 180 + grain * 0.72 + ripple, 105 + grain * 0.42);
    }
  }
  writePng('floor_sand_diffuse.png', size, size, pixels);
}

/** 生成金色符文传送门贴图。 */
function generatePortal() {
  const size = 512;
  const pixels = makePixels(size);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) / cx;
      const angle = Math.atan2(dy, dx);
      const ring = Math.abs(d - 0.72) < 0.025 || Math.abs(d - 0.43) < 0.014;
      const rune = Math.abs(Math.sin(angle * 12) * 0.72 + Math.cos(d * 28)) > 1.26 && d > 0.46 && d < 0.77;
      const glow = Math.max(0, 1 - d) ** 2;
      const alpha = clamp((ring || rune ? 210 : glow * 130) + (noise(x, y, 7) > 0.993 ? 180 : 0));
      setPixel(pixels, size, x, y, 255, 197 + glow * 42, 82 + glow * 80, alpha);
    }
  }
  writePng('portal_gold.png', size, size, pixels);
}

/** 生成半透明金边 UI 面板纹理。 */
function generateUiFrame() {
  const size = 512;
  const pixels = makePixels(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const n = fbm(x / 40, y / 40, 63);
      if (edge < 7 || (edge < 17 && (x + y) % 9 < 2)) {
        setPixel(pixels, size, x, y, 245, 190 + n * 38, 84, 210);
      } else {
        setPixel(pixels, size, x, y, 23 + n * 18, 15 + n * 10, 9 + n * 6, 148);
      }
    }
  }
  writePng('ui_gold_frame.png', size, size, pixels);
}

/** 生成半透明金色准星。 */
function generateCrosshair() {
  const size = 128;
  const pixels = makePixels(size);
  const c = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      const line = (dx < 2 && dy > 10 && dy < 36) || (dy < 2 && dx > 10 && dx < 36);
      const dotRing = Math.abs(Math.hypot(x - c, y - c) - 8) < 1.2;
      setPixel(pixels, size, x, y, 255, 208, 95, line || dotRing ? 175 : 0);
    }
  }
  writePng('crosshair_gold.png', size, size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
generateWallDiffuse();
generateWallRoughness();
generateFloorDiffuse();
generatePortal();
generateUiFrame();
generateCrosshair();
console.log(`Generated textures in ${OUT_DIR}`);
