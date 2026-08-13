import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const src = "D:/APO_Project/VxAPO/VxAPO_icon_v4.svg";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const svg = readFileSync(src, "utf8");
// 图标用途去掉投影滤镜：小尺寸下高斯模糊会糊成一团
const cleanSvg = svg.replace(/ filter="url\(#filter0_d_72_34\)"/g, "");

function renderMaster(size) {
  return new Resvg(cleanSvg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

async function downscale(size) {
  return sharp(await renderMaster(512))
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

// 小尺寸用无压缩 32 位 DIB（Windows 任务栏最稳的渲染方式）
async function toDib(size) {
  const png = await downscale(size);
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = ((size - 1 - y) * size + x) * 4;
      xor[di] = data[si + 2]; // B
      xor[di + 1] = data[si + 1]; // G
      xor[di + 2] = data[si]; // R
      xor[di + 3] = data[si + 3]; // A
    }
  }
  const maskRow = Math.ceil(size / 8);
  const maskRowPadded = Math.ceil(maskRow / 4) * 4;
  const andMask = Buffer.alloc(maskRowPadded * size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  return Buffer.concat([header, xor, andMask]);
}

const pngSizes = [
  ["32x32.png", 32],
  ["64x64.png", 64],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
];
for (const [name, size] of pngSizes) {
  writeFileSync(join(outDir, name), await downscale(size));
  console.log("wrote", name);
}

// ICO：≤64 用 DIB，128/256 用 PNG；64 放最前（资源编译链路可能只取首图，
// 首图用 64 保证各缩放档都是大图缩小；构建后再用 rcedit 全量替换）
const icoSizes = [64, 32, 16, 24, 48, 128, 256];
const blobs = [];
for (const s of icoSizes) {
  blobs.push(s <= 64 ? await toDib(s) : await downscale(s));
}
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(blobs.length, 4);
const entries = [];
let offset = 6 + 16 * blobs.length;
blobs.forEach((b, i) => {
  const s = icoSizes[i];
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(b.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += b.length;
});
writeFileSync(join(outDir, "icon.ico"), Buffer.concat([header, ...entries, ...blobs]));
console.log("wrote icon.ico");
