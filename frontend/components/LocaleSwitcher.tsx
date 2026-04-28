/**
 * LocaleSwitcher Component
 * Allows users to change the application language
 */

'use client';

import React from 'react';
import { useLocale } from '@/hooks/useI18n';
import { getAvailableLocales } from '@/i18n';

interface LocaleSwitcherProps {
  className?: string;
  showLabel?: boolean;
  compact?: boolean;
}

export default function LocaleSwitcher({
  className = '',
  showLabel = true,
  compact = false,
}: LocaleSwitcherProps) {
  const { locale, setLocale } = useLocale();
  const locales = getAvailableLocales();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showLabel && (
        <label
          className={`text-xs font-medium text-neutral-400 ${
            compact ? 'hidden sm:block' : ''
          }`}
        >
          Language:
        </label>
      )}

      {compact ? (
        // Dropdown version for compact layouts
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as any)}
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
          aria-label="Select language"
        >
          {locales.map((loc) => (
            <option key={loc.code} value={loc.code}>
              {loc.flag} {loc.nativeName}
            </option>
          ))}
        </select>
      ) : (
        // Button group version for wider layouts
        <div className="flex items-center gap-1 bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-1">
          {locales.map((loc) => (
            <button
              key={loc.code}
              onClick={() => setLocale(loc.code)}
              className={`px-2 py-1 rounded transition-all text-sm font-medium ${
                locale === loc.code
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'
              }`}
              aria-label={`Switch to ${loc.nativeName}`}
              aria-pressed={locale === loc.code}
              title={loc.nativeName}
            >
              {loc.flag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
