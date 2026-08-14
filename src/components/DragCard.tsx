import { type CSSProperties, type ReactNode } from "react";

interface DragCardProps {
  id: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  hidden?: boolean;
  onDragStart: (key: string, x: number, y: number) => void;
}

export default function DragCard({ id, children, className = "", style, hidden = false, onDragStart }: DragCardProps) {
  return (
    <div className={`drag-card ${className}`} data-dnd-id={id} style={{ ...style, display: hidden ? "none" : undefined }}>
      <div
        className="drag-bar"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          // 捕获指针：拖出窗口/移出卡片后仍能收到 move/up，避免拖拽“丢针”
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* 不支持捕获的环境继续走 window 监听 */
          }
          onDragStart(id, e.clientX, e.clientY);
        }}
      >
        <span className="drag-bar-line" />
      </div>
      {children}
    </div>
  );
}
