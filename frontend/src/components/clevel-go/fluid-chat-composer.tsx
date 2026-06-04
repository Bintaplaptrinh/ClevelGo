"use client";

import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type ComposerPhase = "idle" | "morph" | "fall" | "splat" | "bottom";

type FluidChatComposerProps = {
  disabled?: boolean;
  forceDocked?: boolean;
  isThinking?: boolean;
  onSubmit: (message: string) => void;
};

const spring = {
  type: "spring" as const,
  stiffness: 180,
  damping: 22,
  mass: 0.9,
};

export function FluidChatComposer({
  disabled,
  forceDocked = false,
  isThinking,
  onSubmit,
}: FluidChatComposerProps) {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<ComposerPhase>(forceDocked ? "bottom" : "idle");
  const [fallDistance, setFallDistance] = useState(360);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const setDistance = () => {
      setFallDistance(Math.max(210, window.innerHeight / 2 - 118));
    };

    setDistance();
    window.addEventListener("resize", setDistance);

    return () => window.removeEventListener("resize", setDistance);
  }, []);

  const controls = useMemo(
    () => ({
      idle: {
        width: "min(720px, calc(100vw - 40px))",
        minHeight: 118,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        borderRadius: 28,
      },
      morph: {
        width: 92,
        minHeight: 104,
        y: 0,
        scaleX: 0.86,
        scaleY: 0.92,
        borderRadius: "18px 18px 58px 58px",
      },
      fall: {
        width: 82,
        minHeight: 118,
        y: fallDistance,
        scaleX: 0.68,
        scaleY: 1.42,
        borderRadius: "28px 28px 64px 64px",
      },
      splat: {
        width: 132,
        minHeight: 56,
        y: fallDistance,
        scaleX: 1.55,
        scaleY: 0.48,
        borderRadius: "52px 52px 30px 30px",
      },
      bottom: {
        width: "min(860px, calc(100vw - 32px))",
        minHeight: 76,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        borderRadius: 24,
      },
    }),
    [fallDistance],
  );

  const runSequence = () => {
    if (shouldReduceMotion) {
      setPhase("bottom");
      return;
    }

    setPhase("morph");
    window.setTimeout(() => setPhase("fall"), 230);
    window.setTimeout(() => setPhase("splat"), 720);
    window.setTimeout(() => setPhase("bottom"), 940);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = value.trim();

    if (!message || disabled || (phase !== "idle" && phase !== "bottom")) {
      return;
    }

    setValue("");
    if (phase === "idle") {
      runSequence();
    }
    onSubmit(message);
  };

  const isCompact = phase !== "idle" && phase !== "bottom";
  const isDocked = phase === "bottom";

  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-live="polite">
      <svg className="pointer-events-none absolute h-0 w-0" aria-hidden="true">
        <filter id="gooey-liquid">
          <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation="9" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            result="gooey"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
          />
          <feBlend in="SourceGraphic" in2="gooey" />
        </filter>
      </svg>

      <motion.div
        className={cn(
          "pointer-events-auto absolute left-1/2 -translate-x-1/2",
          isDocked ? "bottom-5 sm:bottom-7" : "top-1/2 -translate-y-1/2",
        )}
        layoutId="clevel-go-fluid-composer-shell"
        layout
        transition={spring}
      >
        <motion.form
          onSubmit={handleSubmit}
          className={cn(
            "liquid-glass relative isolate overflow-hidden border border-white/70 bg-white/78 px-4 py-3 shadow-[0_28px_90px_rgba(29,121,242,0.16)] backdrop-blur-2xl",
            isThinking ? "thinking-border" : "border-slate-200/80",
          )}
          animate={controls[phase]}
          initial={false}
          transition={spring}
          style={{ filter: isCompact ? "url(#gooey-liquid)" : undefined }}
        >
          <AnimatePresence mode="wait">
            {!isCompact ? (
              <motion.div
                key="composer-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.16 }}
                className="relative z-10 flex h-full flex-col gap-3"
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-1 size-4 shrink-0 text-[#1D79F2]" />
                  <textarea
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    disabled={disabled || isThinking}
                    rows={isDocked ? 1 : 3}
                    placeholder="Ask Clevel Go to profile a table, explain a pipeline, or draft a SQL transform..."
                    className="min-h-10 flex-1 resize-none bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={!value.trim() || disabled || isThinking}
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-[#1D79F2] text-white shadow-[0_10px_28px_rgba(29,121,242,0.35)] transition hover:scale-105 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    aria-label="Send message"
                    title="Send"
                  >
                    {isThinking ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pl-7">
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-2.5 text-xs font-medium text-slate-600 transition hover:border-[#1D79F2]/50 hover:text-[#1D79F2]"
                  >
                    <Sparkles className="size-3.5" />
                    <span>Deep research</span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="drop"
                className="absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.95),rgba(29,121,242,0.28)_55%,rgba(29,121,242,0.48))]"
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            )}
          </AnimatePresence>
        </motion.form>
      </motion.div>
    </div>
  );
}
