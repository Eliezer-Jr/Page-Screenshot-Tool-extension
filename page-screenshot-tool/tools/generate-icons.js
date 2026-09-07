/* Generates the extension's dependency-free PNG icons. Run with: node tools/generate-icons.js */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const outputDirectory = path.join(__dirname, "..", "icons");
fs.mkdirSync(outputDirectory, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const dx = Math.max(left + radius - x, 0, x - (right - radius));
  const dy = Math.max(top + radius - y, 0, y - (bottom - radius));
  return Math.hypot(dx, dy) - radius;
}

function createIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const inTile = roundedRectDistance(px, py, size * .04, size * .04, size * .96, size * .96, size * .22) <= 0;
          if (!inTile) continue;

          const t = py / size;
          let r = 52 - 28 * t;
          let g = 120 - 45 * t;
          let b = 246 - 54 * t;
          const inset = size * .25;
          const shortEdge = size * .42;
          const farEdge = size - shortEdge;
          const oppositeInset = size - inset;
          const line = Math.max(.8, size * .035);
          const inLeftArm = px >= inset - line && px <= shortEdge;
          const inRightArm = px <= oppositeInset + line && px >= farEdge;
          const inTopArm = py >= inset - line && py <= shortEdge;
          const inBottomArm = py <= oppositeInset + line && py >= farEdge;
          const cornerLine =
            (Math.abs(py - inset) < line && (inLeftArm || inRightArm)) ||
            (Math.abs(py - oppositeInset) < line && (inLeftArm || inRightArm)) ||
            (Math.abs(px - inset) < line && (inTopArm || inBottomArm)) ||
            (Math.abs(px - oppositeInset) < line && (inTopArm || inBottomArm));
          if (cornerLine) r = g = b = 255;
          red += r; green += g; blue += b; alpha += 255;
        }
      }
      const count = samples * samples;
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(red / count);
      pixels[offset + 1] = Math.round(green / count);
      pixels[offset + 2] = Math.round(blue / count);
      pixels[offset + 3] = Math.round(alpha / count);
    }
  }

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outputDirectory, `icon${size}.png`), createIcon(size));
}
