"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type TypingAnimationProps = {
  children: string;
  className?: string;
  delay?: number;
  duration?: number;
  onComplete?: () => void;
};

export function TypingAnimation({
  children,
  className,
  delay = 160,
  duration = 38,
  onComplete,
}: TypingAnimationProps) {
  const words = useMemo(() => children.trim().split(/\s+/), [children]);
  const [visibleWords, setVisibleWords] = useState(0);

  useEffect(() => {
    const startTimer = window.setTimeout(() => {
      const interval = window.setInterval(() => {
        setVisibleWords((current) => {
          if (current >= words.length) {
            window.clearInterval(interval);
            onComplete?.();
            return current;
          }

          return current + 1;
        });
      }, duration);
    }, delay);

    return () => {
      window.clearTimeout(startTimer);
    };
  }, [children, delay, duration, onComplete, words.length]);

  return (
    <span className={cn("inline text-pretty", className)}>
      {words.slice(0, visibleWords).join(" ")}
      {visibleWords < words.length ? (
        <span className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-caret bg-[#1D79F2]" />
      ) : null}
    </span>
  );
}
