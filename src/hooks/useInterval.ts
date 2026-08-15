import { useEffect, useRef } from "react";

/** 固定间隔轮询：回调始终读取最新闭包，delay 为 null 时暂停，卸载自动清理 */
export function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (delay == null) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}
