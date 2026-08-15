import { memo } from "react";

interface ToastProps {
  message: string;
}

function Toast({ message }: ToastProps) {
  return (
    <div className="vx-toast" role="status">
      {message}
    </div>
  );
}

export default memo(Toast);
