import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getLang, subscribeLang, type Lang } from "./i18n/core";

const I18nContext = createContext<Lang>("zh");

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang());
  useEffect(() => subscribeLang(() => setLangState(getLang())), []);
  return <I18nContext.Provider value={lang}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
