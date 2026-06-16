"use client";

import { ArrowUp, Check, ChevronDown, FileText, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type ComposerPhase = "idle" | "morph" | "fall" | "splat" | "bottom";

export type ModelOption = {
  id: string;
  label: string;
  provider: string;
};

type FluidChatComposerProps = {
  disabled?: boolean;
  forceDocked?: boolean;
  isThinking?: boolean;
  models?: ModelOption[];
  selectedModelId?: string | null;
  onSelectModel?: (modelId: string) => void;
  onSubmit: (message: string, files: File[]) => void;
};

const spring = {
  type: "spring" as const,
  stiffness: 180,
  damping: 22,
  mass: 0.9,
};

// Files the assistant can review or fix: PDFs plus common code/text formats.
const ACCEPTED_FILE_EXTENSIONS = [
  ".pdf",
  ".py",
  ".ipynb",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".md",
  ".mdx",
  ".json",
  ".txt",
  ".yml",
  ".yaml",
  ".csv",
  ".sql",
  ".sh",
  ".vue",
  ".svelte",
  ".c",
  ".cpp",
  ".h",
  ".java",
  ".go",
  ".rb",
  ".rs",
  ".php",
];
const ACCEPT_ATTR = ACCEPTED_FILE_EXTENSIONS.join(",");
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function isAcceptedFile(file: File) {
  const name = file.name.toLowerCase();
  return ACCEPTED_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function FluidChatComposer({
  disabled,
  forceDocked = false,
  isThinking,
  models = [],
  selectedModelId = null,
  onSelectModel,
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
    const message = value.trim() || (selectedFiles.length > 0 ? "Review and fix the uploaded file(s)." : "");

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
      const key = `${file.name}-${file.size}-${file.lastModified}`;

      if (!isAcceptedFile(file) || file.size > MAX_UPLOAD_BYTES || currentKeys.has(key)) {
        rejected.push(file.name);
        continue;
      }

      accepted.push(file);
      currentKeys.add(key);
    }

    setSelectedFiles((current) => [...current, ...accepted].slice(0, 3));
    setFileError(rejected.length > 0 ? `Unsupported or too large. Skipped ${rejected.join(", ")}` : "");
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
              Drop a PDF or code file here
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
                    accept={ACCEPT_ATTR}
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
                    aria-label="Attach file"
                    title="Attach PDF or code file"
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
                    placeholder="Ask Clevel Go"
                    className="min-h-10 flex-1 resize-none bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                  />
                  {models.length > 0 ? (
                    <ModelPicker
                      models={models}
                      selectedModelId={selectedModelId}
                      onSelectModel={onSelectModel}
                      disabled={disabled || isThinking}
                    />
                  ) : null}
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

type ModelPickerProps = {
  models: ModelOption[];
  selectedModelId?: string | null;
  onSelectModel?: (modelId: string) => void;
  disabled?: boolean;
};

type MenuPlacement = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  direction: "down" | "up";
};

function ModelPicker({ models, selectedModelId, onSelectModel, disabled }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement>({ left: 0, top: 0, width: 208, direction: "down" });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = models.find((model) => model.id === selectedModelId) ?? models[0];

  useEffect(() => setMounted(true), []);

  const positionMenu = () => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const width = Math.max(rect.width, 208);
    const estimatedHeight = Math.min(models.length * 40 + 8, 260);
    const spaceBelow = window.innerHeight - rect.bottom;

    // Default to dropping down; only flip up if there's no room (e.g. docked at the bottom).
    if (spaceBelow < estimatedHeight + 16) {
      setPlacement({ left: rect.left, bottom: window.innerHeight - rect.top + 8, width, direction: "up" });
    } else {
      setPlacement({ left: rect.left, top: rect.bottom + 8, width, direction: "down" });
    }
  };

  const toggleOpen = () => {
    if (!open) {
      positionMenu();
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const reposition = () => positionMenu();

    document.addEventListener("mousedown", handlePointer);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, models.length]);

  const offscreenY = placement.direction === "down" ? -8 : 8;

  const menu = (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={menuRef}
          role="listbox"
          initial={{ opacity: 0, scale: 0.94, y: offscreenY }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: offscreenY }}
          transition={{ type: "spring", stiffness: 360, damping: 26, mass: 0.6 }}
          style={{
            position: "fixed",
            left: placement.left,
            top: placement.direction === "down" ? placement.top : undefined,
            bottom: placement.direction === "up" ? placement.bottom : undefined,
            width: placement.width,
          }}
          className={cn(
            "z-[80] overflow-hidden rounded-xl border border-white/70 bg-white/95 py-1 shadow-[0_18px_52px_rgba(15,23,42,0.2)] backdrop-blur-2xl",
            placement.direction === "down" ? "origin-top" : "origin-bottom",
          )}
        >
          {models.map((model) => {
            const isActive = model.id === selected?.id;
            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onSelectModel?.(model.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-50",
                  isActive ? "text-[#1D79F2]" : "text-slate-700",
                )}
              >
                <span className="truncate">{model.label}</span>
                {isActive ? <Check className="size-4 shrink-0" /> : null}
              </button>
            );
          })}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <div className="mt-0.5 shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className="flex h-9 max-w-[150px] items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 text-xs font-medium text-slate-600 transition hover:border-[#1D79F2]/50 hover:text-[#1D79F2] disabled:cursor-not-allowed disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose model"
      >
        <span className="truncate">{selected?.label ?? "Model"}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition", open ? "rotate-180" : "")} />
      </button>

      {mounted ? createPortal(menu, document.body) : null}
    </div>
  );
}
