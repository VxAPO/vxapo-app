// VxAPO App — 边缘染色层入口（决策 5：结构在 lib/edgetint/ 下，本文件只保留挂载点）。
//
// 图层实现按职责拆分：canvasPool（画布池与层级）、tint（采样与绘制）、
// targets（目标扫描与观察者）、renderLoop（渲染循环与生命周期）；模块级状态在 state.ts。


import { useEffect, type RefObject } from "react";
import { ST } from "../lib/edgetint/state";
import { startAuto, stopAuto } from "../lib/edgetint/targets";

/**
 * 边缘染色入口（决策 5 阶段 B：生命周期化）。
 *
 * 挂载时启动自动扫描、卸载时停掉：
 * - 删除原先的「import 即自启动」——模块被 import（含类型引用、测试）不再有副作用；
 * - 删除 `import.meta.hot.dispose` 自救——HMR 更新时 React Fast Refresh 会走 hook 的
 *   cleanup 卸载旧实例，自救逻辑已冗余。
 */
export function useEdgeTintLayer(_ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    // 三个挂载点（App / CurvePanel / 选择工具栏），且工具栏随选中态反复挂卸 ⇒
    // 用引用计数保证「首个挂载启动、最后一个卸载停止」，避免工具栏一隐藏就停掉整层染色。
    ST.autoRefCount += 1;
    if (ST.autoRefCount === 1) startAuto();
    return () => {
      ST.autoRefCount -= 1;
      if (ST.autoRefCount === 0) stopAuto();
    };
  }, []);
}
