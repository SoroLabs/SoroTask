'use client';

import React from 'react';
import { Toaster } from 'sonner';
import { KeyboardShortcutsProvider } from './KeyboardShortcutsProvider';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Mounted once here so every page inherits the same bindings, rather
          than each registering its own set and drifting apart (#875). */}
      <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
      <Toaster
        position="bottom-right"
        theme="dark"
        closeButton
        richColors
        toastOptions={{
          style: {
            background: '#1e293b',
            borderColor: '#334155',
            color: '#f8fafc',
          },
        }}
      />
    </>
  );
}