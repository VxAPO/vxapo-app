import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const EDGES: { dir: ResizeDirection; className: string }[] = [
  { dir: "North", className: "resize-n" },
  { dir: "South", className: "resize-s" },
  { dir: "East", className: "resize-e" },
  { dir: "West", className: "resize-w" },
  { dir: "NorthEast", className: "resize-ne" },
  { dir: "NorthWest", className: "resize-nw" },
  { dir: "SouthEast", className: "resize-se" },
  { dir: "SouthWest", className: "resize-sw" },
];

export default function WindowFrame() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => setEnabled(isTauri()), []);

  if (!enabled) return null;

  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>, dir: ResizeDirection) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    getCurrentWindow()
      .startResizeDragging(dir)
      .catch(() => {});
  };

  return (
    <div className="window-resize-frame">
      {EDGES.map(({ dir, className }) => (
        <div key={dir} className={`window-resize-handle ${className}`} onPointerDown={(e) => onResizeStart(e, dir)} />
      ))}
    </div>
  );
}
