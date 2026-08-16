import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Device } from "../lib/model";
import { readImportFile } from "../lib/api";
import { t } from "../lib/i18n";
import VxSelect from "./VxSelect";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: Device[];
  selectedGuid: string | null;
  onSelectDevice: (guid: string) => void;
  onImport: (guid: string, content: string) => void;
}

function ImportDialog({
  open,
  onOpenChange,
  devices,
  selectedGuid,
  onSelectDevice,
  onImport,
}: ImportDialogProps) {
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Tauri 文件拖放事件：比 HTML5 drop 更可靠，读取路径后由 Rust 读内容
  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        if (!("__TAURI_INTERNALS__" in window)) return;
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const path = event.payload.paths?.[0];
          if (!path) return;
          (async () => {
            try {
              if (!path.toLowerCase().endsWith(".toml")) {
                setError(t("import.invalid"));
                return;
              }
              const text = await readImportFile(path);
              if (!text.trim()) {
                setError(t("import.empty"));
                return;
              }
              setFileName(path.split(/[\\/]/).pop() ?? path);
              setFileText(text);
              setError("");
            } catch {
              setError(t("import.readError"));
            }
          })();
        });
      } catch {
        /* 非 Tauri 或旧版 API，保留 HTML5 drop */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setFileText("");
      setFileName("");
      setError("");
      setDragOver(false);
    }
  }, [open]);

  const readFile = useCallback((file: File) => {
    setError("");
    if (!file.name.toLowerCase().endsWith(".toml")) {
      setError(t("import.invalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (!text.trim()) {
        setError(t("import.empty"));
        return;
      }
      setFileName(file.name);
      setFileText(text);
    };
    reader.onerror = () => setError(t("import.readError"));
    reader.readAsText(file);
  }, []);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) readFile(f);
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  };

  const onReset = () => {
    setFileText("");
    setFileName("");
    setError("");
  };

  const submit = () => {
    if (!selectedGuid) {
      setError(t("import.selectDevice"));
      return;
    }
    if (!fileText.trim()) {
      setError(t("import.chooseFile"));
      return;
    }
    onImport(selectedGuid, fileText);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content className="vx-dialog-content vx-dialog-wide" aria-describedby={undefined}>
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">{t("import.title")}</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label={t("close")}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="vx-dialog-body">
            <label className="vx-field">
              <span className="vx-field-label">{t("import.target")}</span>
              <VxSelect
                value={selectedGuid ?? ""}
                options={devices.map((d) => ({ value: d.guid, label: d.name }))}
                onValueChange={onSelectDevice}
                ariaLabel={t("import.target")}
                placeholder={t("import.selectDevice")}
              />
            </label>

            <div className="vx-field">
              <span className="vx-field-label">{t("import.file")}</span>
              {fileText ? (
                <div className="import-preview">
                  <div className="import-preview-head">
                    <span className="import-preview-name">{fileName}</span>
                    <button className="import-reset" type="button" onClick={onReset} aria-label={t("import.chooseFile")}>
                      <X size={14} />
                    </button>
                  </div>
                  <pre className="import-preview-text">{fileText}</pre>
                </div>
              ) : (
                <div
                  className={`import-drop${dragOver ? " drag-over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                >
                  <Plus size={20} className="import-plus" />
                  <span>{t("import.drop")}</span>
                  <input ref={inputRef} type="file" accept=".toml" hidden onChange={onPick} />
                </div>
              )}
            </div>

            {error ? <div className="hint-row show err">{error}</div> : null}

            <div className="vx-dialog-actions">
              <Dialog.Close className="vx-btn ghost" type="button">{t("cancel")}</Dialog.Close>
              <button className="vx-btn primary" type="button" onClick={submit}>{t("import")}</button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(ImportDialog);
