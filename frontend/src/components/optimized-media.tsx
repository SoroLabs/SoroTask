"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type OptimizedMediaProps = {
  alt: string;
  src?: string | null;
  width: number;
  height: number;
  className?: string;
  imageClassName?: string;
  sizes?: string;
  priority?: boolean;
  rounded?: "full" | "xl" | "2xl" | "3xl";
  fallbackLabel: string;
  fallbackTone?: "neutral" | "cyan" | "emerald";
  onRenderComplete?: (state: "loaded" | "fallback", duration: number) => void;
};

const roundedClassNames = {
  full: "rounded-full",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
};

const fallbackToneClassNames = {
  neutral: "from-slate-800 via-slate-900 to-slate-950 text-slate-200",
  cyan: "from-cyan-500/25 via-slate-900 to-slate-950 text-cyan-50",
  emerald: "from-emerald-500/25 via-slate-900 to-slate-950 text-emerald-50",
};

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function OptimizedMedia({
  alt,
  src,
  width,
  height,
  className,
  imageClassName,
  sizes,
  priority = false,
  rounded = "2xl",
  fallbackLabel,
  fallbackTone = "neutral",
  onRenderComplete,
}: OptimizedMediaProps) {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(!src);
  const startedAtRef = useRef(
    typeof window === "undefined" ? 0 : window.performance.now(),
  );

  useEffect(() => {
    if (!hasFailed) {
      return;
    }

    const duration =
      typeof window === "undefined"
        ? 0
        : window.performance.now() - startedAtRef.current;
    onRenderComplete?.("fallback", Number(duration.toFixed(2)));
  }, [hasFailed, onRenderComplete]);

  const roundedClassName = roundedClassNames[rounded];

  return (
    <div
      className={joinClasses(
        "media-frame relative isolate overflow-hidden bg-slate-900/80",
        roundedClassName,
        className,
      )}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {!hasFailed ? (
        <>
          <Image
            alt={alt}
            src={src ?? ""}
            width={width}
            height={height}
            sizes={sizes}
            priority={priority}
            loading={priority ? "eager" : "lazy"}
            className={joinClasses(
              "h-full w-full object-cover transition duration-500",
              hasLoaded ? "scale-100 opacity-100" : "scale-[1.02] opacity-0",
              imageClassName,
            )}
            onLoad={() => {
              setHasLoaded(true);
              const duration =
                typeof window === "undefined"
                  ? 0
                  : window.performance.now() - startedAtRef.current;
              onRenderComplete?.("loaded", Number(duration.toFixed(2)));
            }}
            onError={() => setHasFailed(true)}
          />
          {!hasLoaded ? (
            <div
              aria-hidden="true"
              className={joinClasses(
                "absolute inset-0 animate-pulse bg-[linear-gradient(120deg,rgba(15,23,42,0.95),rgba(34,211,238,0.12),rgba(15,23,42,0.95))]",
                roundedClassName,
              )}
            />
          ) : null}
        </>
      ) : (
        <div
          className={joinClasses(
            "flex h-full w-full items-center justify-center bg-gradient-to-br text-center",
            fallbackToneClassNames[fallbackTone],
            roundedClassName,
          )}
        >
          <span className="px-3 text-xs font-semibold uppercase tracking-[0.24em]">
            {fallbackLabel}
          </span>
        </div>
      )}
    </div>
  );
}
