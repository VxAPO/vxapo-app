/** 拖拽排序 API 的子集（视图只用到这些；useDragSort 的返回值结构上兼容）。 */
export interface DragApi {
  activeKey: string | null;
  fly: { key: string } | null;
  virtualIndexOf: (key: string) => number | null;
  startDrag: (key: string, x: number, y: number) => void;
}
