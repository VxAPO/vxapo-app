import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const src = "D:/APO_Project/VxAPO/VxAPO_icon_v4.svg";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const svg = readFileSync(src, "utf8");

function renderPng(size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

const pngSizes = [
  ["32x32.png", 32],
  ["64x64.png", 64],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
];
for (const [name, size] of pngSizes) {
  writeFileSync(join(outDir, name), renderPng(size));
  console.log("wrote", name);
}

// ICO（PNG 压缩条目，16–256 多尺寸，Windows 任务栏/窗口图标）
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const blobs = icoSizes.map((s) => renderPng(s));
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
