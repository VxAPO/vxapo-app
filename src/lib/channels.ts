const CHANNEL_LABELS: Record<string, string> = {
  L: "ch.L",
  R: "ch.R",
  C: "ch.C",
  LFE: "ch.LFE",
  BL: "ch.BL",
  BR: "ch.BR",
  SL: "ch.SL",
  SR: "ch.SR",
};

import { t } from "./i18n";

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
  return t(CHANNEL_LABELS[id] ?? id);
}
