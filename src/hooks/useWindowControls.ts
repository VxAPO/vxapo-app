import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type VxapoBridge = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: (channel: string, cb: (payload: unknown) => void) => () => void;
};
const vxapoBridge = (): VxapoBridge | null =>
  typeof window !== "undefined" && "vxapo" in window
    ? (window as unknown as { vxapo: VxapoBridge }).vxapo
    : null;

export function useWindowControls() {
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    const init = async () => {
      // Electron 双模：走 window.vxapo 桥；否则回退 Tauri
      const bridge = vxapoBridge();
      if (bridge) {
        void bridge.invoke<boolean>("win_is_maximized").then(setIsMax);
        dispose = bridge.listen("win-max-state", (v) => setIsMax(!!v));
        return;
      }
      try {
        const w = getCurrentWindow();
        setIsMax(await w.isMaximized());
        const unlisten = await w.onResized(() => {
          void w.isMaximized().then(setIsMax);
        });
        dispose = unlisten;
      } catch {
        /* web fallback */
      }
    };
    void init();
    return () => dispose?.();
  }, []);

  const minimize = useCallback(() => {
    const bridge = vxapoBridge();
    if (bridge) {
      void bridge.invoke("win_minimize");
      return;
    }
    try {
      void getCurrentWindow().minimize();
    } catch {
      /* web fallback */
    }
  }, []);

  const toggleMaximize = useCallback(async () => {
    const bridge = vxapoBridge();
    if (bridge) {
      setIsMax(!!(await bridge.invoke<boolean>("win_toggle_maximize")));
      return;
    }
    try {
      const w = getCurrentWindow();
      await w.toggleMaximize();
      setIsMax(await w.isMaximized());
    } catch {
      /* web fallback */
    }
  }, []);

  const close = useCallback(() => {
    const bridge = vxapoBridge();
    if (bridge) {
      void bridge.invoke("win_close");
      return;
    }
    try {
      void getCurrentWindow().close();
    } catch {
      /* web fallback */
    }
  }, []);

  return { isMax, minimize, toggleMaximize, close };
}
