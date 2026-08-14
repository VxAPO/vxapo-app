import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowControls() {
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    const init = async () => {
      try {
        const w = getCurrentWindow();
        setIsMax(await w.isMaximized());
        const unlisten = await w.onResized(() => {
          void w.isMaximized().then(setIsMax);
        });
        dispose = unlisten;
      } catch { /* web fallback */ }
    };
    void init();
    return () => dispose?.();
  }, []);

  const minimize = () => {
    try { void getCurrentWindow().minimize(); } catch { /* web fallback */ }
  };

  const toggleMaximize = async () => {
    try {
      const w = getCurrentWindow();
      await w.toggleMaximize();
      setIsMax(await w.isMaximized());
    } catch { /* web fallback */ }
  };

  const close = () => {
    try { void getCurrentWindow().close(); } catch { /* web fallback */ }
  };

  return { isMax, minimize, toggleMaximize, close };
}
