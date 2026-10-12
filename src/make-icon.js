// Gera assets/icon.png (32x32) — um anel verde simples, para a bandeja.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 32, H = 32;
function pixel(x, y) {
  const cx = 15.5, cy = 15.5;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= 14 && d >= 9) return [74, 222, 128, 255]; // anel
  if (d < 5) return [74, 222, 128, 255];             // ponto central
  return [0, 0, 0, 0];                               // transparente
}

const raw = Buffer.alloc((W * 4 + 1) * H);
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0; // filtro 0
  for (let x = 0; x < W; x++) {
    const p = pixel(x, y);
    raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3];
  }
}
const comp = zlib.deflateSync(raw);

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", comp), chunk("IEND", Buffer.alloc(0))]);

const dir = path.join(__dirname, "..", "assets");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon.png"), png);
console.log("icon.png gerado em", path.join(dir, "icon.png"));
