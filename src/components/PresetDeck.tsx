import type { PresetLibraryEntry } from "../lib/model";
import { presetAccent, presetCardStyle } from "../lib/blocks";
import { t, useI18n } from "../lib/i18n";

interface PresetDeckProps {
  library: PresetLibraryEntry[];
  usedPresets: string[];
  onApplyPreset: (p: PresetLibraryEntry) => void;
}

/** 预设列表 —— 与「高级」区一致的紧凑条目：flex+gap、hover 阴影、点击添加。 */
export default function PresetDeck({ library, usedPresets, onApplyPreset }: PresetDeckProps) {
  const lang = useI18n();
  return (
    <div className="preset-list">
      {library.map((p) => {
        const used = usedPresets.includes(p.id);
        const name = lang === "en" ? (p.name_en ?? p.name) : p.name;
        const group = lang === "en" ? (p.group_en ?? p.group) : p.group;
        return (
          <button
            key={p.id}
            type="button"
            className={`adv-pill preset-pill${used ? " disabled" : ""}`}
            disabled={used}
            style={presetCardStyle(p.color ?? presetAccent(p.bands))}
            onClick={() => onApplyPreset(p)}
            title={used ? `${name}${t("effect.added")}` : name}
          >
            <span className="preset-dot" aria-hidden="true" />
            <span className="preset-name">
              <span className="p-group">{group}</span>
              <span className="p-sub">{name}</span>
            </span>
            {used && <span className="preset-added">{t("effect.added")}</span>}
          </button>
        );
      })}
    </div>
  );
}
