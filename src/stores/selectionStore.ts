// VxAPO App — 选中 / 工具栏联动（决策 4 阶段 B）。
//
// 取代 App 里那四个「渲染期跨 hook 赋值」的 ref（accentOfRef / selectedIdsRef /
// cancelToolbarAnimRef / bumpSelGeomTickRef）：视图动画与框选 hook 都改读本 store，
// 写入方（App）只在渲染提交后写入。默认值与原本 ref 的初值一致。
import { create } from "zustand";
import type { Block } from "../lib/model";

interface SelectionStore {
  /** 已选元素键（块 id 或 `e-<effect id>`）。 */
  selectedIds: string[];
  /** 取块的高亮色（由框选 hook 提供，未就绪时返回兜底色）。 */
  accentOf: (b: Block) => string;
  /** 取消工具栏动画（由框选 hook 提供）。 */
  cancelToolbarAnim: () => void;
  /** 让工具栏几何重算一帧（由框选 hook 提供）。 */
  bumpSelGeomTick: () => void;

  setSelectedIds(next: string[]): void;
  setAccentOf(fn: (b: Block) => string): void;
  setCancelToolbarAnim(fn: () => void): void;
  setBumpSelGeomTick(fn: () => void): void;
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedIds: [],
  accentOf: () => "#519741",
  cancelToolbarAnim: () => {},
  bumpSelGeomTick: () => {},

  setSelectedIds(next) {
    set({ selectedIds: next });
  },
  setAccentOf(fn) {
    set({ accentOf: fn });
  },
  setCancelToolbarAnim(fn) {
    set({ cancelToolbarAnim: fn });
  },
  setBumpSelGeomTick(fn) {
    set({ bumpSelGeomTick: fn });
  },
}));
