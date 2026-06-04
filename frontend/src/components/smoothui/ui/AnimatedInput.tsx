"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

type AnimatedInputProps = Omit<ComponentPropsWithoutRef<"input">, "id"> & {
  icon?: ReactNode;
  label: string;
};

export function AnimatedInput({
  className,
  icon,
  label,
  value,
  onFocus,
  onBlur,
  ...props
}: AnimatedInputProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const isActive = focused || Boolean(value);

  return (
    <label
      htmlFor={id}
      className={cn(
        "group relative flex h-11 items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white/80 px-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl",
        className,
      )}
    >
      {icon ? (
        <span className="text-slate-400 transition-colors group-focus-within:text-[#1D79F2]" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="relative flex min-w-0 flex-1 items-center">
        <motion.span
          className="pointer-events-none absolute left-0 text-sm text-slate-400"
          animate={{
            y: isActive ? -11 : 0,
            scale: isActive ? 0.78 : 1,
            color: isActive ? "#1D79F2" : "#94a3b8",
          }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 32 }
          }
          style={{ originX: 0 }}
        >
          {label}
        </motion.span>
        <input
          id={id}
          value={value}
          aria-label={label}
          className="h-8 w-full bg-transparent pt-3 text-sm text-slate-700 outline-none placeholder:text-transparent"
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
      </span>
      <motion.span
        className="absolute inset-x-3 bottom-0 h-px bg-[#1D79F2]"
        initial={false}
        animate={{ scaleX: focused ? 1 : 0 }}
        transition={
          shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }
        }
        style={{ originX: 0.5 }}
      />
    </label>
  );
}
