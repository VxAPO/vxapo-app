// VxAPO App — 亚像素对齐工具：按设备像素网格取整，
// 避免小数位定位/移动动画导致文字发虚或出现 1px 级偏移。

const DPR = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

export function snapPx(v: number): number {
  return Math.round(v * DPR) / DPR;
}
