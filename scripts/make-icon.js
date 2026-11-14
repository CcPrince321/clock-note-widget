// 生成托盘图标 assets/tray.png（32x32 蓝色圆点），纯本地生成，无任何网络请求
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 32, H = 32;
const cx = 15.5, cy = 15.5, r = 15;

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  const rowStart = y * (W * 4 + 1);
  raw[rowStart] = 0; // PNG 行过滤器: None
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const i = rowStart + 1 + x * 4;
    if (d <= r) {
      raw[i] = 41; raw[i + 1] = 128; raw[i + 2] = 255; raw[i + 3] = 255; // 蓝色不透明
    } else {
      raw[i] = 0; raw[i + 1] = 0; raw[i + 2] = 0; raw[i + 3] = 0; // 透明
    }
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'tray.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon written:', out, png.length, 'bytes');
