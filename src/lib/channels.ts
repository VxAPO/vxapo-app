const CHANNEL_LABELS: Record<string, string> = {
  L: "左声道",
  R: "右声道",
  C: "中置",
  LFE: "低音",
  BL: "后左",
  BR: "后右",
  SL: "侧左",
  SR: "侧右",
};

/** 与 driver get_channel_names 同款标准声道短名（按掩码位顺序） */
export function channelNamesFor(channelCount: number | null | undefined): string[] {
  switch (channelCount) {
    case 1:
      return ["L"];
    case 2:
      return ["L", "R"];
    case 4:
      return ["L", "R", "BL", "BR"];
    case 6:
      return ["L", "R", "C", "LFE", "BL", "BR"];
    case 8:
      return ["L", "R", "C", "LFE", "BL", "BR", "SL", "SR"];
    default:
      return ["L", "R"];
  }
}

export function channelLabel(id: string): string {
  return CHANNEL_LABELS[id] ?? id;
}
