"use client";
import { useEffect, useState } from "react";
import { getStoredLocale, type Locale } from "@/lib/theme";

export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>("zh");
  useEffect(() => {
    setLocale(getStoredLocale());
    function onLocaleChange() {
      setLocale(getStoredLocale());
    }
    window.addEventListener("finfold-locale-change", onLocaleChange);
    return () => window.removeEventListener("finfold-locale-change", onLocaleChange);
  }, []);
  return locale;
}
