// @vitest-environment jsdom
//
// NumInput 行为测试：核心是 type=number 的键入中间态（"-"、清空）读出为空串，
// 受控回写会把它顶成 0——负号根本打不进来。这里验证中间态不入 store、
// 不被回写，失焦才收口。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import NumInput from "./NumInput";

// React act() 在测试环境需要显式开启
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 用原型 setter 直写绕过 React 挂在实例上的 value tracker，
// 再派发 input 事件——等价于真实键入（浏览器改值不走 JS setter）。
const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<Parameters<typeof NumInput>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <NumInput value={1000} min={20} max={20000} onCommit={() => {}} {...props} />,
    );
  });
  return container.querySelector("input") as HTMLInputElement;
}

/** 模拟键入：改 DOM 值后派发原生 input 事件（React 的 onChange 挂在 input 上） */
function type(el: HTMLInputElement, v: string) {
  act(() => {
    nativeSet.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 模拟失焦：派发 focusout（React 17+ 的 onBlur 监听 focusout） */
function blur(el: HTMLInputElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe("NumInput 键入中间态", () => {
  it("\"-\" 中间态：不提交 store（旧实现 Number('')=0 会把负号顶成 0）", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit });
    type(el, "-");
    expect(onCommit).not.toHaveBeenCalled();
    // 中间态在浏览器/jsdom 里读出是空串（value sanitization），且没有被回写成 "0"/"1000"
    expect(el.value).toBe("");
    // 接着补数字 → 整体提交为负数
    type(el, "-5");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(-5);
    expect(el.value).toBe("-5");
  });

  it("清空不归零：删除全部内容不提交，store 保持原值", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit });
    type(el, "");
    expect(onCommit).not.toHaveBeenCalled();
    expect(el.value).toBe("");
    blur(el);
    expect(onCommit).not.toHaveBeenCalled();
    expect(el.value).toBe("1000");
  });

  it("非完整数字（\"1e\" 读出空串）不提交", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit });
    type(el, "1e");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("合法值逐键提交（store 语义保留，滑块联动靠 store）", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit });
    type(el, "1");
    type(el, "12");
    expect(onCommit).toHaveBeenNthCalledWith(1, 1);
    expect(onCommit).toHaveBeenNthCalledWith(2, 12);
  });
});

describe("NumInput 失焦收口", () => {
  it("越界值夹回边界并回写", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit });
    type(el, "30000");
    blur(el);
    expect(onCommit).toHaveBeenLastCalledWith(20000);
    expect(el.value).toBe("20000");
  });

  it("负数越界夹到下界（gain 输入 -99 → -30）", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit, value: 0, min: -30, max: 30 });
    type(el, "-99");
    blur(el);
    expect(onCommit).toHaveBeenLastCalledWith(-30);
    expect(el.value).toBe("-30");
  });

  it("输入负数（-5）失焦保留在域内，不夹走", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit, value: 0, min: -30, max: 30 });
    type(el, "-5");
    blur(el);
    expect(onCommit).toHaveBeenLastCalledWith(-5);
    expect(el.value).toBe("-5");
  });

  it("未改动的值失焦不回写（不触发 markDirty）", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit });
    blur(el);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("效果器卡：display 显示收口值，失焦把收口值回写 store（raw 越界场景）", () => {
    // store 原始键入 999，显示域已 clamp 到 48（preamp gain 上限口径）
    const onCommit = vi.fn();
    const el = render({ value: 999, display: 48, min: -60, max: 48, onCommit });
    expect(el.value).toBe("48");
    blur(el);
    expect(onCommit).toHaveBeenCalledWith(48);
    expect(el.value).toBe("48");
  });
});

describe("NumInput 外部值同步", () => {
  it("未聚焦时外部值变化同步进输入框（滑块拖动/回读）", () => {
    const onCommit = vi.fn();
    const el = render({ value: 1000, onCommit });
    act(() => {
      root.render(<NumInput value={2500} min={20} max={20000} onCommit={onCommit} />);
    });
    expect(el.value).toBe("2500");
  });

  it("聚焦期间外部值变化不回写（聚焦不回读策略）", () => {
    const onCommit = vi.fn();
    const el = render({ value: 1000, onCommit });
    act(() => el.focus());
    act(() => {
      root.render(<NumInput value={2500} min={20} max={20000} onCommit={onCommit} />);
    });
    expect(document.activeElement).toBe(el);
    expect(el.value).toBe("1000");
    act(() => el.blur());
  });

  it("Enter 触发失焦收口", () => {
    const onCommit = vi.fn();
    const el = render({ onCommit });
    act(() => el.focus());
    type(el, "99999");
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(el.value).toBe("20000");
    expect(onCommit).toHaveBeenLastCalledWith(20000);
  });
});
