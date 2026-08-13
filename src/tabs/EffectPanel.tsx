import type { ModuleInstance, Preset } from "../types";
import DimensionSlider from "../components/DimensionSlider";

interface EffectPanelProps {
  presets: Preset[];
  modules: ModuleInstance[];
}

export default function EffectPanel({ presets, modules }: EffectPanelProps) {
  const first = modules[0] ? presets.find((p) => p.id === modules[0].presetId) : undefined;

  if (!first) {
    return (
      <div className="placeholder-panel">
        <span>TAB 2「感知调节」规划中（阶段 D）</span>
        <span>先在 TAB 1 添加一个预设，这里会展示它的感知维度滑条</span>
      </div>
    );
  }

  return (
    <div className="placeholder-panel">
      <span>TAB 2「感知调节」规划中（阶段 D）——以下为 {first.name} 的维度预览（只读）</span>
      {first.dimensions.map((dim) => (
        <DimensionSlider
          key={dim.id}
          dimension={dim}
          value={Math.min(1, Math.max(0, dim.default_value * modules[0].intensity))}
          onChange={() => {}}
        />
      ))}
    </div>
  );
}
