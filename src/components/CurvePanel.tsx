import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../lib/model";
import { channelLabel } from "../lib/channels";
import { t } from "../lib/i18n/core";
import { useGlassRing } from "../hooks/useGlassRing";
import { useEdgeTintLayer } from "../hooks/useEdgeTintLayer";
import CurvePlot from "./CurvePlot";
import VxSelect from "./VxSelect";

interface CurvePanelProps {
  /**
   * 要画的块：**已经**是目标声道的那一份（App 从曲线快照里给出，见 App 里 liveCurve 的注释）。
   * 这里不再按声道过滤——快照按设计滞后一档，拿它跟当前声道现算比对，会在切声道的那一档把曲线滤空。
   */
  blocks: Block[];
  /** 与 blocks 同档的评估频点（同一份快照里算好的）；缺省由绘制侧按 blocks 自行生成 */
  evalFreqs?: number[];
  fs: number;
  yTop: number;
  yBottom?: number;
  preampGainDb?: number;
  curveChannel: string;
  onCurveChannelChange: (v: string) => void;
  channelOn: boolean;
  channelNames: string[];
}

function CurvePanel({
  blocks,
  evalFreqs,
  fs,
  yTop,
  yBottom,
  preampGainDb = 0,
  curveChannel,
  onCurveChannelChange,
  channelOn,
  channelNames,
}: CurvePanelProps) {
  const [curveW, setCurveW] = useState(() => {
    try {
      return Math.max(660, Math.floor((window.innerWidth || 800) - 320));
    } catch {
      return 660;
    }
  });
  const curveRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const latestWRef = useRef(0);
  // 画什么由 App 决定：传进来的 `blocks` 已经是曲线快照里目标声道的那一份（通道模式=选中声道，
  // 关闭选择器=首声道）。**不要**在这里按 channelOn/curveChannel 再过一遍：快照滞后一档，
  // 与当前声道现算比对会在切声道的那一档把整条曲线滤空（踩过）。
  // 选项列表**始终**是各声道：关闭选择器时不再有「全部声道」这一档（曲线目标始终是单个声道）
  const channelOptions = useMemo(
    () => channelNames.map((c) => ({ value: c, label: channelLabel(c) })),
    [channelNames],
  );

  // 首帧就要把宽度量准：上面那个初值只是拿窗口宽度兜底的估算，若让它先按估算渲染、再等
  // ResizeObserver 修正，SVG 的 viewBox 会横向跳一下（设备页每次重挂载都跳一次）。
  // layout effect 里 setState 会在绘制前同步重渲，这一跳就看不见了。
  useLayoutEffect(() => {
    const el = curveRef.current;
    if (!el) return;
    const w = el.getBoundingClientRect().width;
    if (w > 0) setCurveW(Math.max(660, Math.floor(w + 20)));
  }, []);

  useEffect(() => {
    const el = curveRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      latestWRef.current = w || 0;
      if (!w || w <= 0 || rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        // 跟随窗口收窄，低于 660px 才进入遮挡；读最新宽度而非回调闭包的旧值
        const next = Math.max(660, Math.floor(latestWRef.current + 20));
        setCurveW((prev) => (prev === next ? prev : next));
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useGlassRing(fxRef);
  useEdgeTintLayer(fxRef);

  return (
    <div className="fx fx-curve" ref={fxRef}>
      <div className="curve-wrap" ref={curveRef}>
        <div className="curve-head">
          <span className="t">{t("freqResponse")}</span>
          <VxSelect
            value={curveChannel}
            options={channelOptions}
            onValueChange={onCurveChannelChange}
            ariaLabel={t("channels")}
            // 关闭选择器时锁定在首声道（左）：换声道的入口在声道胶囊那侧，这里置灰，
            // 否则它看着能选、选完又被 handleCurveChannelChange 忽略，是个"点了没反应"的死控件
            disabled={!channelOn}
          />
        </div>
        <CurvePlot
          blocks={blocks}
          evalFreqs={evalFreqs}
          fs={fs}
          curveW={curveW}
          yTop={yTop}
          yBottom={yBottom}
          preampGainDb={preampGainDb}
        />
      </div>
    </div>
  );
}

export default memo(CurvePanel);
