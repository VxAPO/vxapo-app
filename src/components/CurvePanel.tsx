import { useEffect, useRef, useState } from "react";
import type { Block } from "../lib/model";
import CurvePlot from "./CurvePlot";
import VxSelect from "./VxSelect";

interface CurvePanelProps {
  blocks: Block[];
  fs: number;
  yTop: number;
  curveChannel: string;
  onCurveChannelChange: (v: string) => void;
}

export default function CurvePanel({ blocks, fs, yTop, curveChannel, onCurveChannelChange }: CurvePanelProps) {
  const [curveW, setCurveW] = useState(640);
  const curveRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = curveRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setCurveW(Math.max(320, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="curve-wrap" ref={curveRef}>
      <div className="curve-head">
        <span className="t">频响曲线</span>
        <VxSelect
          value={curveChannel}
          options={[
            { value: "左声道", label: "左声道" },
            { value: "右声道", label: "右声道" },
          ]}
          onValueChange={onCurveChannelChange}
          ariaLabel="声道"
        />
      </div>
      <CurvePlot blocks={blocks} fs={fs} curveW={curveW} yTop={yTop} />
    </div>
  );
}
