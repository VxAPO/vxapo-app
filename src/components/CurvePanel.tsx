import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../lib/model";
import { channelLabel } from "../lib/channels";
import CurvePlot from "./CurvePlot";
import VxSelect from "./VxSelect";

interface CurvePanelProps {
  blocks: Block[];
  fs: number;
  yTop: number;
  curveChannel: string;
  onCurveChannelChange: (v: string) => void;
  channelOn: boolean;
  channelNames: string[];
  firstChannel: string;
}

function CurvePanel({
  blocks,
  fs,
  yTop,
  curveChannel,
  onCurveChannelChange,
  channelOn,
  channelNames,
  firstChannel,
}: CurvePanelProps) {
  const [curveW, setCurveW] = useState(640);
  const curveRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const visibleBlocks = useMemo(
    () =>
      channelOn
        ? blocks.filter((b) => (b.channel ?? firstChannel) === curveChannel)
        : blocks,
    [blocks, channelOn, curveChannel, firstChannel],
  );
  const channelOptions = useMemo(
    () =>
      channelOn
        ? channelNames.map((c) => ({ value: c, label: channelLabel(c) }))
        : [{ value: "all", label: "全部声道" }],
    [channelOn, channelNames],
  );

  useEffect(() => {
    const el = curveRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (!w || w <= 0 || rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        // 跟随窗口收窄，低于 660px 才进入遮挡
        const next = Math.max(660, Math.floor(w + 20));
        setCurveW((prev) => (prev === next ? prev : next));
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="curve-wrap" ref={curveRef}>
      <div className="curve-head">
        <span className="t">频响曲线</span>
        <VxSelect
          value={curveChannel}
          options={channelOptions}
          onValueChange={onCurveChannelChange}
          ariaLabel="声道"
        />
      </div>
      <CurvePlot
        blocks={visibleBlocks}
        fs={fs}
        curveW={curveW}
        yTop={yTop}
      />
    </div>
  );
}

export default memo(CurvePanel);
