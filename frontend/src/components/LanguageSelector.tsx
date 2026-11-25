"use client";

import React, { useState } from "react";
import { SupportedLocale } from "../lib/i18n/translations";

export interface LanguageSelectorProps {
  currentLocale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  className?: string;
}

const LANGUAGES: { code: SupportedLocale; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
];

export function LanguageSelector({ currentLocale, onLocaleChange, className = "" }: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const activeLang = LANGUAGES.find((l) => l.code === currentLocale) || LANGUAGES[0];

  return (
    <div className={`relative inline-block text-left ${className}`} data-testid="language-selector">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 focus:outline-none"
      >
        <span>{activeLang.flag}</span>
        <span>{activeLang.label}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 w-36 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-lg">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => {
                onLocaleChange(lang.code);
                setIsOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-left ${
                lang.code === currentLocale ? "bg-indigo-600/30 text-indigo-300 font-semibold" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
