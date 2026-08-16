import { memo, useEffect, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { Block } from "../lib/model";
import { accentHoverColor, presetAccent, semanticName } from "../lib/blocks";
import { t } from "../lib/i18n";

interface SavePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  defaultName: string;
  onSave: (name: string, desc: string, color: string, descriptions: string[]) => void;
}

const SWATCHES = [
  "#da5788", "#df5770", "#e15957", "#e05d40", "#dd6222", "#d76a00",
  "#cd7300", "#798e11", "#519741", "#009c65", "#00a58d", "#00a3a5",
  "#00a4c1", "#009dd4", "#0096e2", "#358fe9", "#6082e9", "#8078e5",
  "#996fda", "#ae67c9", "#c360bc", "#d05ba5", "#d8588f", "#de5778",
];

function fmtFc(fc: number): string {
  return fc >= 1000 ? `${(fc / 1000).toFixed(2)} kHz` : `${Math.round(fc)} Hz`;
}

function fmtDb(db: number): string {
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

/** 保存自定义预设：可编辑整体名称与每段 PEAK 的语义描述 */
function SavePresetDialog({
  open,
  onOpenChange,
  blocks,
  defaultName,
  onSave,
}: SavePresetDialogProps) {
  const [name, setName] = useState(defaultName);
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("#6fbf73");
  const [descs, setDescs] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setDesc("");
      setColor(presetAccent(blocks.map((b) => b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 })));
      setDescs(blocks.map((b) => b.name?.trim() || semanticName(b)));
    }
  }, [open, blocks, defaultName]);

  const save = () => {
    onSave(name.trim() || t("preset.name.placeholder"), desc.trim(), color, descs.map((d) => d.trim()));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content className="vx-dialog-content vx-dialog-wide" aria-describedby={undefined}>
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">{t("preset.saveTitle")}</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label={t("close")}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="vx-dialog-body">
            <label className="vx-field">
              <span className="vx-field-label">{t("preset.name")}</span>
              <input
                className="vx-text-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("preset.name.placeholder")}
              />
            </label>
            <label className="vx-field">
              <span className="vx-field-label">{t("preset.desc")}</span>
              <input
                className="vx-text-input"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={t("preset.desc.placeholder")}
              />
            </label>
            <div className="vx-field">
              <span className="vx-field-label">{t("preset.color")}</span>
              <div className="preset-swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`preset-swatch${color === c ? " active" : ""}`}
                    style={{ background: c, "--swatch-hover": accentHoverColor(c) ?? c } as CSSProperties}
                    aria-label={`${t("preset.color")} ${c}`}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
            <div className="vx-field">
              <span className="vx-field-label">{t("preset.bandDesc")}</span>
              <div className="preset-band-list">
                {blocks.map((b, i) => {
                  const band = b.bands[0];
                  return (
                    <div className="preset-band-row" key={b.id ?? i}>
                      <span className="preset-band-tag">
                        {band ? `${fmtFc(band.fc)} · ${fmtDb(band.gain_db)}` : "—"}
                      </span>
                      <input
                        className="vx-text-input"
                        value={descs[i] ?? ""}
                        onChange={(e) =>
                          setDescs((prev) => prev.map((d, j) => (j === i ? e.target.value : d)))
                        }
                        placeholder={t("preset.bandDesc")}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="vx-dialog-actions">
            <Dialog.Close className="vx-btn ghost" type="button">{t("cancel")}</Dialog.Close>
            <button className="vx-btn primary" type="button" onClick={save}>{t("save")}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(SavePresetDialog);
