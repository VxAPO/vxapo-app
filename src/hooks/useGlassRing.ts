import { useLayoutEffect, type RefObject } from "react";

/** HMR 模块实例 token：热更新后强制 effect 重新应用最新常量。 */
const HOT_TOKEN = (import.meta as unknown as { hot?: unknown }).hot;

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
  // 顶部亮线两端衰减按像素换算成角度：宽卡/窄卡视觉长度一致
  const toolbar = el.classList.contains("fx-toolbar");
  const corner = toolbar ? 14 : 16;
  const xEnd = Math.max(2, w / 2 - corner);
  const yHalf = Math.max(1, h / 2);
  const aEnd = (Math.atan2(xEnd, yHalf) * 180) / Math.PI;
  const topFadePx = el.classList.contains("fx-curve") ? 30 : 13;
  const aTopFull = (Math.atan2(Math.max(1, xEnd - topFadePx), yHalf) * 180) / Math.PI;
  const fadeDeg = Math.max(0.15, aEnd - aTopFull);
  el.style.setProperty(
    "--ring-fade",
    `${fadeDeg.toFixed(2)}deg`,
  );
  // 底部独立按左下圆角切线收敛，避免复用右上角造成不同宽卡手感不一
  const aMid = (Math.atan2(xEnd, yHalf) * 180) / Math.PI;
  const brEdge = 180 - aMid;
  const blEdge = 180 + aMid;
  const aBlFull = (Math.atan2(Math.max(1, xEnd - 13), yHalf) * 180) / Math.PI;
  const fadeBlDeg = Math.max(0.15, aMid - aBlFull);
  el.style.setProperty("--ang-br-edge", `${brEdge.toFixed(2)}deg`);
  el.style.setProperty("--ang-bl-edge", `${blEdge.toFixed(2)}deg`);
  el.style.setProperty("--ring-fade-bl", `${fadeBlDeg.toFixed(2)}deg`);
}

/** 观察包裹元素尺寸，动态刷新环带四角角度。 */
export function useGlassRing(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    let bound: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    let scheduled = false;
    const update = () => {
      if (bound) applyRingAngles(bound);
    };
    const bind = () => {
      if (bound && !bound.isConnected) {
        ro?.disconnect();
        ro = null;
        bound = null;
      }
      const node = ref.current;
      if (!node || !node.isConnected || node === bound) return;
      ro?.disconnect();
      bound = node;
      update();
      ro = new ResizeObserver(update);
      ro.observe(bound);
    };
    // 拔插/安装后设备页是晚挂载的，不能只轮询几秒就放弃；
    // MutationObserver 监听节点出现，长驻 interval 兜底极慢枚举。
    const mo = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        bind();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(bind, 1000);
    const late = window.setTimeout(bind, 300);
    const onFocus = () => bind();
    window.addEventListener("focus", onFocus);
    bind();
    return () => {
      mo.disconnect();
      window.clearInterval(timer);
      window.clearTimeout(late);
      window.removeEventListener("focus", onFocus);
      ro?.disconnect();
    };
  }, [ref, HOT_TOKEN]);
}
