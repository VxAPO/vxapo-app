// VxAPO App — 预设与设备示例数据（App 引用规范 §3.2）
// 先为静态示例数据；后续改为后端 load_presets() / list_devices()。

import type { Device, Filter, Preset } from "../types";

export const PRESETS: Preset[] = [
  {
    id: "night-cinema",
    name: "深夜影院",
    description: "低频下沉，人声拉近，高频柔化",
    use_case: "适合：深夜看电影，不想吵到邻居",
    icon: "🎬",
    default_intensity: 0.7,
    dimensions: [
      {
        id: "bass-thickness",
        name: "低音厚度",
        low_label: "轻薄",
        high_label: "厚重",
        description:
          "控制鼓声和贝斯的存在感。往右会让低频更有力、更有氛围感，但太高会让人声变糊。",
        default_value: 0.6,
        mappings: [
          { filter_index: 0, param: "gain", min_value: -6, max_value: 6 },
          { filter_index: 1, param: "gain", min_value: 1, max_value: -1 },
        ],
      },
      {
        id: "vocal-clarity-night",
        name: "人声清晰度",
        low_label: "靠后",
        high_label: "贴耳",
        description:
          "控制人声的亲近感。往右会让人声更突出、更清晰，像在耳边说话。太高会变得刺耳。",
        default_value: 0.3,
        mappings: [{ filter_index: 2, param: "gain", min_value: -3, max_value: 6 }],
      },
      {
        id: "treble-softness",
        name: "高频柔和度",
        low_label: "明亮",
        high_label: "柔和",
        description:
          "控制高频的锐利程度。往右会减少刺耳感，声音更耐听。太高会让声音变闷、失去细节。",
        default_value: 0.75,
        mappings: [{ filter_index: 3, param: "gain", min_value: 2, max_value: -6 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "LowShelf",
        frequency: 80,
        gain: 3.2,
        q: 0.7,
        label: "低频抬升",
        source: "低音厚度",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 300,
        gain: -0.5,
        q: 1.0,
        label: "中低频补偿",
        source: "低音厚度",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 2500,
        gain: 1.8,
        q: 1.2,
        label: "人声存在感",
        source: "人声清晰度",
      },
      {
        enabled: true,
        type: "HighShelf",
        frequency: 12000,
        gain: -2.0,
        q: 0.7,
        label: "高频柔化",
        source: "高频柔和度",
      },
    ],
  },
  {
    id: "fps-footstep",
    name: "FPS 脚步增强",
    description: "中高频抬升，低频压制，脚步/换弹声更突出",
    use_case: "适合：竞技游戏，听声辨位",
    icon: "🎯",
    default_intensity: 0.6,
    dimensions: [
      {
        id: "footstep-prominence",
        name: "脚步突出度",
        low_label: "自然",
        high_label: "突出",
        description:
          "控制脚步声和环境音的突出程度。往右会让细微声音更清晰，但音乐会失真。",
        default_value: 0.65,
        mappings: [
          { filter_index: 0, param: "gain", min_value: 0, max_value: 8 },
          { filter_index: 1, param: "gain", min_value: 0, max_value: 6 },
        ],
      },
      {
        id: "bass-suppress",
        name: "低频压制",
        low_label: "保留",
        high_label: "压制",
        description:
          "压制低频爆炸声和背景轰鸣，让脚步声不会被掩盖。太高会失去方向感。",
        default_value: 0.5,
        mappings: [{ filter_index: 2, param: "gain", min_value: 0, max_value: -8 }],
      },
      {
        id: "treble-detail",
        name: "高频解析",
        low_label: "柔和",
        high_label: "锐利",
        description:
          "提升高频细节，换弹、拉栓声更清脆。太高会长时间游戏耳朵疲劳。",
        default_value: 0.4,
        mappings: [{ filter_index: 3, param: "gain", min_value: 0, max_value: 5 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "Peak",
        frequency: 2500,
        gain: 5.2,
        q: 1.4,
        label: "中高频存在感",
        source: "脚步突出度",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 4000,
        gain: 3.9,
        q: 1.8,
        label: "细节解析",
        source: "脚步突出度",
      },
      {
        enabled: true,
        type: "LowShelf",
        frequency: 150,
        gain: -4.0,
        q: 0.7,
        label: "低频压制",
        source: "低频压制",
      },
      {
        enabled: true,
        type: "HighShelf",
        frequency: 8000,
        gain: 2.0,
        q: 0.7,
        label: "高频锐化",
        source: "高频解析",
      },
    ],
  },
  {
    id: "vocal-clarity",
    name: "人声清晰化",
    description: "1kHz–4kHz 区域温和提升，减少低频掩蔽效应",
    use_case: "适合：播客、在线会议、有声书",
    icon: "🎙️",
    default_intensity: 0.8,
    dimensions: [
      {
        id: "vocal-presence",
        name: "人声存在感",
        low_label: "自然",
        high_label: "突出",
        description:
          "控制人声在混音中的突出程度。往右让人声更靠前，会议或播客听得更清楚。",
        default_value: 0.6,
        mappings: [
          { filter_index: 0, param: "gain", min_value: 0, max_value: 6 },
          { filter_index: 1, param: "gain", min_value: 0, max_value: 4 },
        ],
      },
      {
        id: "sibilance-control",
        name: "齿音控制",
        low_label: "保留",
        high_label: "抑制",
        description:
          "控制 S、T 等齿音的强度。往右减少刺耳的齿音，但太多会让说话含糊。",
        default_value: 0.35,
        mappings: [{ filter_index: 2, param: "gain", min_value: 0, max_value: -6 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "Peak",
        frequency: 2500,
        gain: 3.6,
        q: 1.2,
        label: "人声频段提升",
        source: "人声存在感",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 3500,
        gain: 2.4,
        q: 1.5,
        label: "临场感",
        source: "人声存在感",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 6800,
        gain: -2.1,
        q: 2.5,
        label: "齿音抑制",
        source: "齿音控制",
      },
    ],
  },
  {
    id: "bass-boost",
    name: "低音增强",
    description: "温和低频 shelf，提升鼓声和贝斯的存在感",
    use_case: "适合：电子音乐、摇滚、电影配乐",
    icon: "🔊",
    default_intensity: 0.3,
    dimensions: [
      {
        id: "bass-volume",
        name: "低音量感",
        low_label: "克制",
        high_label: "澎湃",
        description:
          "控制整体低频的量感。往右让鼓声更有力，贝斯更深沉。太高会轰头、失去清晰度。",
        default_value: 0.5,
        mappings: [{ filter_index: 0, param: "gain", min_value: 0, max_value: 8 }],
      },
      {
        id: "bass-elasticity",
        name: "低音弹性",
        low_label: "紧致",
        high_label: "松散",
        description:
          "控制低音的松紧感。往右让低音更有弹性、更有律动感，但太松会模糊。",
        default_value: 0.4,
        mappings: [{ filter_index: 0, param: "q", min_value: 1.0, max_value: 0.4 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "LowShelf",
        frequency: 100,
        gain: 4.0,
        q: 0.7,
        label: "低频增强",
        source: "低音量感",
      },
    ],
  },
  {
    id: "warmth",
    name: "声音温暖化",
    description: "略微提升中低频，衰减高频刺耳区域",
    use_case: "适合：长时间聆听，减少疲劳感",
    icon: "☕",
    default_intensity: 0.4,
    dimensions: [
      {
        id: "warmth-feel",
        name: "温暖感",
        low_label: "清冷",
        high_label: "温暖",
        description:
          "控制中低频的饱满程度。往右让声音更温暖、更有模拟感。太多会变糊。",
        default_value: 0.5,
        mappings: [{ filter_index: 0, param: "gain", min_value: 0, max_value: 4 }],
      },
      {
        id: "harshness-suppress",
        name: "刺耳抑制",
        low_label: "明亮",
        high_label: "圆润",
        description:
          "抑制高频刺耳区域，让声音更圆润耐听。太多会失去空气感和细节。",
        default_value: 0.45,
        mappings: [{ filter_index: 1, param: "gain", min_value: 0, max_value: -4 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "Peak",
        frequency: 350,
        gain: 2.0,
        q: 0.9,
        label: "中低频温暖",
        source: "温暖感",
      },
      {
        enabled: true,
        type: "HighShelf",
        frequency: 10000,
        gain: -1.8,
        q: 0.7,
        label: "刺耳抑制",
        source: "刺耳抑制",
      },
    ],
  },
  {
    id: "game-immersion",
    name: "沉浸游戏",
    description: "中高频定位清晰，低频氛围饱满，脚步声、换弹声更分明",
    use_case: "适合：3A 大作、开放世界、需要听声辨位的游戏",
    icon: "🎮",
    default_intensity: 0.65,
    dimensions: [
      {
        id: "spatial-cue",
        name: "空间定位",
        low_label: "平面",
        high_label: "立体",
        description: "提升中高频的指向感，让左右声像和远近层次更清楚。太高会偏硬。",
        default_value: 0.6,
        mappings: [
          { filter_index: 0, param: "gain", min_value: 0, max_value: 5 },
          { filter_index: 1, param: "gain", min_value: 0, max_value: 3 },
        ],
      },
      {
        id: "atmosphere-bass",
        name: "氛围低频",
        low_label: "克制",
        high_label: "沉浸",
        description: "给爆炸、引擎和环境音加一点厚度，不掩盖细节。太高会闷。",
        default_value: 0.45,
        mappings: [{ filter_index: 2, param: "gain", min_value: 0, max_value: 4 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "Peak",
        frequency: 3000,
        gain: 3.5,
        q: 1.1,
        label: "空间指向感",
        source: "空间定位",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 6000,
        gain: 2.0,
        q: 1.4,
        label: "细节层次",
        source: "空间定位",
      },
      {
        enabled: true,
        type: "LowShelf",
        frequency: 120,
        gain: 2.4,
        q: 0.7,
        label: "氛围低频",
        source: "氛围低频",
      },
    ],
  },
  {
    id: "classical-stage",
    name: "古典现场",
    description: "中性自然，保留动态和空间感，减少器材染色",
    use_case: "适合：交响乐、室内乐、现场录音",
    icon: "🎻",
    default_intensity: 0.5,
    dimensions: [
      {
        id: "stage-openness",
        name: "舞台开扬",
        low_label: "内敛",
        high_label: "开扬",
        description: "让高频泛音更舒展，弦乐和铜管更透气。太高会刺耳。",
        default_value: 0.5,
        mappings: [{ filter_index: 0, param: "gain", min_value: 0, max_value: 3 }],
      },
      {
        id: "body-warmth",
        name: "琴体共鸣",
        low_label: "清瘦",
        high_label: "饱满",
        description: "补一点中低频的琴腔共鸣，让大提琴和木管更真实。",
        default_value: 0.4,
        mappings: [{ filter_index: 1, param: "gain", min_value: 0, max_value: 2.5 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "HighShelf",
        frequency: 8000,
        gain: 1.6,
        q: 0.7,
        label: "泛音开扬",
        source: "舞台开扬",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 400,
        gain: 1.2,
        q: 0.8,
        label: "琴体共鸣",
        source: "琴体共鸣",
      },
    ],
  },
  {
    id: "edm-club",
    name: "电音夜店",
    description: "深低音冲击，高频亮丽，鼓点更弹",
    use_case: "适合：EDM、嘻哈、电子舞曲",
    icon: "🪩",
    default_intensity: 0.6,
    dimensions: [
      {
        id: "sub-punch",
        name: "低音冲击",
        low_label: "轻",
        high_label: "重",
        description: "强化鼓点和贝斯的冲击力。太高会轰头。",
        default_value: 0.6,
        mappings: [
          { filter_index: 0, param: "gain", min_value: 0, max_value: 7 },
          { filter_index: 1, param: "gain", min_value: 0, max_value: 4 },
        ],
      },
      {
        id: "shine",
        name: "高频光泽",
        low_label: "暗",
        high_label: "亮",
        description: "提升合成器和踩镲的亮度。太高会累。",
        default_value: 0.5,
        mappings: [{ filter_index: 2, param: "gain", min_value: 0, max_value: 4 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "LowShelf",
        frequency: 90,
        gain: 4.5,
        q: 0.7,
        label: "低音冲击",
        source: "低音冲击",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 200,
        gain: 2.6,
        q: 1.0,
        label: "鼓点弹性",
        source: "低音冲击",
      },
      {
        enabled: true,
        type: "HighShelf",
        frequency: 9000,
        gain: 2.8,
        q: 0.7,
        label: "高频光泽",
        source: "高频光泽",
      },
    ],
  },
  {
    id: "podcast-voice",
    name: "播客人声",
    description: "中频靠前，齿音收敛，长时间听不累",
    use_case: "适合：播客、有声书、网课",
    icon: "🎤",
    default_intensity: 0.7,
    dimensions: [
      {
        id: "voice-forward",
        name: "人声靠前",
        low_label: "自然",
        high_label: "靠前",
        description: "让说话声更突出，不会被背景音乐盖住。",
        default_value: 0.6,
        mappings: [{ filter_index: 0, param: "gain", min_value: 0, max_value: 5 }],
      },
      {
        id: "sibilance-tame",
        name: "齿音收敛",
        low_label: "保留",
        high_label: "收敛",
        description: "压制 S、T 等齿音的刺耳感。太多会发闷。",
        default_value: 0.45,
        mappings: [{ filter_index: 1, param: "gain", min_value: 0, max_value: -5 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "Peak",
        frequency: 2200,
        gain: 3.2,
        q: 1.2,
        label: "人声靠前",
        source: "人声靠前",
      },
      {
        enabled: true,
        type: "Peak",
        frequency: 7000,
        gain: -2.6,
        q: 2.0,
        label: "齿音收敛",
        source: "齿音收敛",
      },
    ],
  },
  {
    id: "sleep-calming",
    name: "助眠舒缓",
    description: "高频柔化，低频松弛，白噪音更绵密",
    use_case: "适合：睡前音乐、白噪音、冥想",
    icon: "🌙",
    default_intensity: 0.5,
    dimensions: [
      {
        id: "softness",
        name: "柔和度",
        low_label: "清晰",
        high_label: "柔化",
        description: "大幅柔化高频，去掉尖刺感。太高会发闷。",
        default_value: 0.7,
        mappings: [{ filter_index: 0, param: "gain", min_value: 0, max_value: -7 }],
      },
      {
        id: "low-relax",
        name: "低频松弛",
        low_label: "紧",
        high_label: "松",
        description: "让低频更松弛绵密，不突兀。",
        default_value: 0.4,
        mappings: [{ filter_index: 1, param: "gain", min_value: 0, max_value: 2 }],
      },
    ],
    filters: [
      {
        enabled: true,
        type: "HighShelf",
        frequency: 6000,
        gain: -4.5,
        q: 0.7,
        label: "高频柔化",
        source: "柔和度",
      },
      {
        enabled: true,
        type: "LowShelf",
        frequency: 150,
        gain: 1.4,
        q: 0.7,
        label: "低频松弛",
        source: "低频松弛",
      },
    ],
  },
];

export const DEVICES: Device[] = [
  { id: "speaker-001", name: "桌面音箱", icon: "🔊", flow: "playback", installed: true, format: "2ch · 48kHz · 32bit" },
  { id: "headphone-001", name: "游戏耳机", icon: "🎧", flow: "playback", installed: true, format: "2ch · 48kHz · 24bit" },
  { id: "headphone-002", name: "监听耳机", icon: "🎧", flow: "playback", installed: false, format: "2ch · 44.1kHz · 24bit" },
  { id: "mic-001", name: "桌面麦克风", icon: "🎤", flow: "capture", installed: false, format: "1ch · 48kHz · 32bit" },
];

export const FILTER_TYPE_MAP: Record<string, string> = {
  Peak: "PK",
  LowShelf: "LS",
  HighShelf: "HS",
  LowPass: "LP",
  HighPass: "HP",
  Notch: "NO",
  BandPass: "BP",
};

export const DEFAULT_PREAMP_DB = -2.3;

export function fmtFreq(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}kHz` : `${f}Hz`;
}

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function expandPresetFilters(preset: Preset, intensity: number): Filter[] {
  // 有效维度值 = dimension.default_value × intensity（intent 5.2，钳制 [0,1]）。
  const filters = preset.filters.map((f) => ({ ...f }));
  for (const dim of preset.dimensions) {
    const effective = Math.min(1, Math.max(0, dim.default_value * intensity));
    for (const m of dim.mappings) {
      const target = filters[m.filter_index];
      if (!target) continue;
      const t = m.interpolation === "logarithmic"
        ? Math.log1p(effective * 9) / Math.log(10)
        : m.interpolation === "exponential"
          ? effective * effective
          : effective;
      const value = m.min_value + (m.max_value - m.min_value) * t;
      if (m.param === "gain") target.gain = value;
      else if (m.param === "frequency") target.frequency = value;
      else target.q = value;
      target.source = dim.name;
    }
  }
  return filters.filter((f) => f.enabled);
}

export function clampDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(48, Math.max(-120, db));
}
