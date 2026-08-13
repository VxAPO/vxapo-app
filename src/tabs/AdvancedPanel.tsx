import type { Filter } from "../types";
import FreqResponseCurve from "../components/FreqResponseCurve";
import FilterRow from "../components/FilterRow";

interface AdvancedPanelProps {
  filters: Filter[];
}

export default function AdvancedPanel({ filters }: AdvancedPanelProps) {
  return (
    <div className="placeholder-panel">
      <span>TAB 3「高级模式」规划中（阶段 E）——当前配置的频响预览与滤波器链（只读）</span>
      <div className="curve-wrap">
        <FreqResponseCurve filters={filters} />
      </div>
      {filters.map((f, i) => (
        <FilterRow key={i} filter={f} index={i} readOnly />
      ))}
    </div>
  );
}
