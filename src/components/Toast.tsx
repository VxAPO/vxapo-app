import { memo } from "react";
import { motion } from "framer-motion";

interface ToastProps {
  message: string;
}

function Toast({ message }: ToastProps) {
  return (
    <motion.div
      className="vx-toast"
      role="status"
      initial={{ opacity: 0, x: "-50%", y: 8 }}
      animate={{ opacity: 1, x: "-50%", y: 0 }}
      exit={{ opacity: 0, x: "-50%", y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {message}
    </motion.div>
  );
}

export default memo(Toast);
