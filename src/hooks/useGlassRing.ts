import { useLayoutEffect, type RefObject } from "react";

/** 按矩形实测宽高计算四个圆角在 conic 渐变里的角度（0°=正上，顺时针），
    注入 --ang-tl/tr/br/bl，让环带的环绕受光真正落在四个角上。 */
export function applyRingAngles(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  if (!w || !h) return;
  const cx = w / 2;
  const cy = h / 2;
  const ang = (dx: number, dy: number): number => {
    let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (a < 0) a += 360;
    return a;
  };
  const set = (k: string, v: number) => el.style.setProperty(k, `${v.toFixed(2)}deg`);
  set("--ang-tl", ang(-cx, -cy));
  set("--ang-tr", ang(cx, -cy));
  set("--ang-br", ang(cx, cy));
  set("--ang-bl", ang(-cx, cy));
}

/** 观察包裹元素尺寸，动态刷新环带四角角度。 */
export function useGlassRing(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => applyRingAngles(el);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
