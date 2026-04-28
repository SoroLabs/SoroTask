'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PortalProps {
  children: React.ReactNode;
  /** The DOM element to render into. Defaults to document.body. */
  container?: Element | null;
}

/**
 * Renders children into a DOM portal, defaulting to document.body.
 * Safe for SSR — renders nothing until mounted on the client.
 */
export function Portal({ children, container }: PortalProps) {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<Element | null>(null);

  useEffect(() => {
    containerRef.current = container ?? document.body;
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, [container]);

  if (!mounted || !containerRef.current) return null;
  return createPortal(children, containerRef.current);
}
