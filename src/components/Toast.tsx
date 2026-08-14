interface ToastProps {
  message: string;
}

export default function Toast({ message }: ToastProps) {
  return (
    <div className="vx-toast" role="status">
      {message}
    </div>
  );
}
