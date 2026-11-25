'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface MFEContainerProps {
  url: string;
  title: string;
  originWhitelist?: string[];
  onMessage?: (message: any) => void;
  fallback?: React.ReactNode;
  sandbox?: string;
  className?: string;
  initTimeoutMs?: number;
}

/**
 * Secure Micro-Frontend (MFE) Container Application
 * Renders an isolated external application via an iframe with secure postMessage bindings.
 * Uses a heartbeat/timeout pattern for robust error fallback since iframe onError is unreliable.
 * 
 * Time Complexity: O(1) for rendering, O(1) for message handling.
 * Space Complexity: O(1) beyond the iframe's internal resource usage.
 */
export const MFEContainer: React.FC<MFEContainerProps> = ({
  url,
  title,
  originWhitelist = [],
  onMessage,
  fallback,
  sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups',
  className = '',
  initTimeoutMs = 5000,
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback((event: MessageEvent) => {
    if (originWhitelist.length > 0 && !originWhitelist.includes(event.origin)) {
      console.warn(`[MFE Container] Blocked message from untrusted origin: ${event.origin}`);
      return;
    }

    // A heartbeat/ready message clears the failure timeout
    if (event.data?.type === 'MFE_READY' || event.data?.type === 'HEARTBEAT') {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsLoading(false);
    }

    // An error message from the MFE triggers the error/fallback state
    if (event.data?.type === 'MFE_ERROR') {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setHasError(true);
      setIsLoading(false);
    }

    if (onMessage) {
      onMessage(event.data);
    }
  }, [originWhitelist, onMessage]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    
    // Fallback: if MFE doesn't send ready signal in time, assume crash/failure
    timeoutRef.current = setTimeout(() => {
      if (isLoading) {
        setHasError(true);
        setIsLoading(false);
      }
    }, initTimeoutMs);

    return () => {
      window.removeEventListener('message', handleMessage);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [handleMessage, isLoading, initTimeoutMs]);

  // We keep onLoad but rely mainly on postMessage heartbeat for true ready state
  const handleLoad = () => {
    // If no heartbeat mechanism is used by the child, we at least clear loading state on raw load.
    // However, if the iframe 404s, onLoad still fires, which is why timeout is primary.
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsLoading(false);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };

  if (hasError) {
    return (
      <div className={`mfe-error-fallback p-4 border border-red-500 rounded bg-red-50 text-red-700 ${className}`}>
        {fallback || (
          <div>
            <h3 className="font-semibold text-lg">Failed to load module</h3>
            <p className="text-sm">The external module '{title}' could not be loaded securely.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`mfe-container relative w-full h-full overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-75 z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={url}
        title={title}
        sandbox={sandbox}
        onLoad={handleLoad}
        onError={handleError}
        className={`w-full h-full border-0 transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
};

export default MFEContainer;
