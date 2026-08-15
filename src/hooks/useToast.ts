import { useCallback, useEffect, useRef, useState } from "react";

export function useToast() {
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2500);
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  return { notice, notify };
}
