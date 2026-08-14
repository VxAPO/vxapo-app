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
          onDragStart(id, e.clientX, e.clientY);
        }}
      >
        <span className="drag-bar-line" />
      </div>
      {children}
    </div>
  );
}
