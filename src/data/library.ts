import type { PresetLibraryEntry } from "../lib/model";

export const LIBRARY: PresetLibraryEntry[] = [
  {
    id: "fps",
    group: "FPS 预设",
    name: "脚步 · 枪声增强",
    desc: "突出脚步与枪声辨识，听声辨位更清楚",
    bands: [
      { fc: 250, gain_db: 4, q: 1.2, name: "脚步声增强" },
      { fc: 3200, gain_db: 3, q: 2, name: "枪声增强" },
    ],
  },
  { id: "cinema", group: "深夜影院", name: "低频下沉", desc: "提升氛围感，低音更沉更稳", bands: [{ fc: 80, gain_db: 3, q: 0.9 }] },
];
