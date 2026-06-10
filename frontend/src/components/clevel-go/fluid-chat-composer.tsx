"use client";

import { ArrowUp, FileText, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type ComposerPhase = "idle" | "morph" | "fall" | "splat" | "bottom";

type FluidChatComposerProps = {
  disabled?: boolean;
  forceDocked?: boolean;
  isThinking?: boolean;
  onSubmit: (message: string, files: File[]) => void;
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<ComposerPhase>(forceDocked ? "bottom" : "idle");
  const [fallDistance, setFallDistance] = useState(360);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    const message = value.trim() || (selectedFiles.length > 0 ? "Summarize the uploaded PDF." : "");

    if ((!message && selectedFiles.length === 0) || disabled || (phase !== "idle" && phase !== "bottom")) {
      return;
    }

    const files = selectedFiles;
    setValue("");
    setSelectedFiles([]);
    setFileError("");
    if (phase === "idle") {
      runSequence();
    }
    onSubmit(message, files);
  };

  const addFiles = (files: FileList | null) => {
    if (!files) {
      return;
    }

    const accepted: File[] = [];
    const rejected: string[] = [];
    const currentKeys = new Set(selectedFiles.map((file) => `${file.name}-${file.size}-${file.lastModified}`));

    for (const file of Array.from(files)) {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const key = `${file.name}-${file.size}-${file.lastModified}`;

      if (!isPdf || file.size > 8 * 1024 * 1024 || currentKeys.has(key)) {
        rejected.push(file.name);
        continue;
      }

      accepted.push(file);
      currentKeys.add(key);
    }

    setSelectedFiles((current) => [...current, ...accepted].slice(0, 3));
    setFileError(rejected.length > 0 ? `PDF only. Skipped ${rejected.join(", ")}` : "");
  };

  const isCompact = phase !== "idle" && phase !== "bottom";

  const handleDrag = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled && !isThinking && !isCompact) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    if (disabled || isThinking || isCompact) {
      return;
    }

    addFiles(event.dataTransfer.files);
  };

  const isDocked = phase === "bottom";
  const canSubmit = Boolean(value.trim() || selectedFiles.length > 0) && !disabled && !isThinking;

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 right-0 z-30 lg:left-[260px]" aria-live="polite">
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
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "liquid-glass relative isolate overflow-hidden border bg-white/78 px-4 py-3 shadow-[0_28px_90px_rgba(29,121,242,0.16)] backdrop-blur-2xl",
            isDragging
              ? "border-[#1D79F2]/70 ring-2 ring-[#1D79F2]/20"
              : isThinking
                ? "thinking-border"
                : "border-white/70",
          )}
          animate={controls[phase]}
          initial={false}
          transition={spring}
          style={{ filter: isCompact ? "url(#gooey-liquid)" : undefined }}
        >
          {isDragging && !isCompact ? (
            <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-[20px] border-2 border-dashed border-[#1D79F2]/50 bg-white/72 text-sm font-semibold text-[#1D79F2] backdrop-blur-xl">
              Drop PDF here
            </div>
          ) : null}
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
                {selectedFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pl-1">
                    {selectedFiles.map((file, index) => (
                      <span
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white/78 px-2.5 py-1 text-xs font-medium text-slate-600"
                      >
                        <FileText className="size-3.5 shrink-0 text-[#1D79F2]" />
                        <span className="max-w-[180px] truncate">{file.name}</span>
                        <button
                          type="button"
                          className="grid size-4 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          onClick={() => setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                          aria-label={`Remove ${file.name}`}
                          title="Remove"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-start gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    hidden
                    onChange={(event) => {
                      addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled || isThinking}
                    className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-slate-200 bg-white/70 text-slate-500 transition hover:border-[#1D79F2]/50 hover:text-[#1D79F2] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Attach PDF"
                    title="Attach PDF"
                  >
                    <Paperclip className="size-4" />
                  </button>
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
                    placeholder="Ask Clevel Go to summarize a PDF, research a topic, plan work, or draft a response..."
                    className="min-h-10 flex-1 resize-none bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-[#1D79F2] text-white shadow-[0_10px_28px_rgba(29,121,242,0.35)] transition hover:scale-105 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    aria-label="Send message"
                    title="Send"
                  >
                    {isThinking ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pl-11">
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-2.5 text-xs font-medium text-slate-600 transition hover:border-[#1D79F2]/50 hover:text-[#1D79F2]"
                  >
                    <Sparkles className="size-3.5" />
                    <span>Deep research</span>
                  </button>
                  {fileError ? <span className="self-center text-xs text-amber-600">{fileError}</span> : null}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="drop"
                className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(29,121,242,0.44))]"
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
