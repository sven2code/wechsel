// Erzeugt die Tray-Icons als PNG (App-Icon: scripts/render-icon.mjs) – ohne externe Abhängigkeiten.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../assets/generated/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rendert Formen (Koordinaten 0..1) mit 4×4-Supersampling. */
function render(size, shapes) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          let col = null;
          for (const s of shapes) if (inside(s, px, py)) col = s.color;
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += col[3]; }
        }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      out[i] = alpha ? Math.round(r / (a / 255)) : 0;
      out[i + 1] = alpha ? Math.round(g / (a / 255)) : 0;
      out[i + 2] = alpha ? Math.round(b / (a / 255)) : 0;
      out[i + 3] = Math.round(alpha);
    }
  return out;
}
function inside(s, px, py) {
  const { x, y, w, h, r = 0 } = s;
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r + 1e-9;
}

// Schreibtisch-Silhouette mit Hubsäule und Monitor
const desk = (c) => [
  { x: 0.1, y: 0.3, w: 0.8, h: 0.11, r: 0.03, color: c },
  { x: 0.44, y: 0.41, w: 0.12, h: 0.42, r: 0, color: c },
  { x: 0.24, y: 0.8, w: 0.52, h: 0.08, r: 0.03, color: c },
  { x: 0.2, y: 0.06, w: 0.36, h: 0.17, r: 0.025, color: c },
  { x: 0.355, y: 0.22, w: 0.05, h: 0.09, r: 0, color: c },
];

const black = [0, 0, 0, 255];
const teal = [38, 120, 112, 255];

for (const [name, size] of [['trayTemplate.png', 16], ['trayTemplate@2x.png', 32]]) {
  writeFileSync(new URL(name, OUT), png(size, render(size, desk(black))));
}
writeFileSync(new URL('tray-win.png', OUT), png(32, render(32, desk(teal))));
console.log('Tray-Icons erzeugt in assets/generated/');
