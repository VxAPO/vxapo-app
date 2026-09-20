import { snapPx } from "../lib/snap";

interface MarqueeBoxProps {
  marquee: { x1: number; y1: number; x2: number; y2: number };
}

/** 框选框（坐标按像素对齐后绘制）。 */
export default function MarqueeBox({ marquee }: MarqueeBoxProps) {
  return (
    <div
      className="marquee-box"
      style={{
        left: snapPx(Math.min(marquee.x1, marquee.x2)),
        top: snapPx(Math.min(marquee.y1, marquee.y2)),
        width: snapPx(Math.abs(marquee.x2 - marquee.x1)),
        height: snapPx(Math.abs(marquee.y2 - marquee.y1)),
      }}
    />
  );
}
