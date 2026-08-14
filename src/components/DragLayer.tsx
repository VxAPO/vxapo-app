import { motion } from "framer-motion";
import type { RefObject, ReactNode } from "react";
import type { FlyState } from "../hooks/useDragSort";

interface DragLayerProps {
  activeKey: string | null;
  dragSize: { width: number; height: number } | null;
  fly: FlyState | null;
  overlayRef: RefObject<HTMLDivElement | null>;
  activeContent: ReactNode;
  classForKey: (key: string) => string;
  onFlyComplete: (id: number) => void;
}

export default function DragLayer({
  activeKey,
  dragSize,
  fly,
  overlayRef,
  activeContent,
  classForKey,
  onFlyComplete,
}: DragLayerProps) {
  return (
    <>
      {activeKey && (
        <div
          ref={overlayRef}
          className={`drag-fly overlay-fixed ${classForKey(activeKey)}`}
          style={dragSize ? { width: dragSize.width, height: dragSize.height } : undefined}
        >
          {activeContent}
        </div>
      )}
      {fly && (
        <motion.div
          className={`drag-fly fly-anim ${classForKey(fly.key)}`}
          initial={{
            left: fly.from.left,
            top: fly.from.top,
            width: fly.from.width,
            height: fly.from.height,
            opacity: 1,
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.18)",
          }}
          animate={{
            left: fly.to.left,
            top: fly.to.top,
            width: fly.to.width,
            height: fly.to.height,
            opacity: 1,
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
          }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          onAnimationComplete={() => onFlyComplete(fly.id)}
        >
          {fly.content}
        </motion.div>
      )}
    </>
  );
}
