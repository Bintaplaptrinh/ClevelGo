"use client";

import { Brain, Check, Copy, Download } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type RichAiMessageProps = {
  content: string;
  citations?: CitationSource[];
  typewriter?: boolean;
};

type CitationSource = {
  id: number;
  title: string;
  url?: string | null;
  snippet: string;
  sourceType: "web" | "url" | "file";
};

type ChartData = {
  title?: string;
  labels: string[];
  values: number[];
};

export function RichAiMessage({ content, citations = [], typewriter = false }: RichAiMessageProps) {
  const { thinking, answer } = useMemo(() => splitThinking(content), [content]);
  const normalizedContent = useMemo(() => normalizeMarkdownContent(answer), [answer]);
  const tokens = useMemo(() => normalizedContent.match(/\s+|\S+/g) ?? [], [normalizedContent]);
  const totalWords = useMemo(() => tokens.filter((token) => /\S/.test(token)).length, [tokens]);
  const [visibleWords, setVisibleWords] = useState(typewriter ? 0 : totalWords);

  useEffect(() => {
    if (!typewriter) {
      return;
    }

    const interval = window.setInterval(() => {
      setVisibleWords((current) => {
        if (current >= totalWords) {
          window.clearInterval(interval);
          return current;
        }

        return current + 1;
      });
    }, 34);

    return () => window.clearInterval(interval);
  }, [typewriter, totalWords]);

  const isStreaming = typewriter && visibleWords < totalWords;
  const visibleContent = typewriter ? revealWords(tokens, visibleWords) : normalizedContent;

  // Show the one-line thinking effect only while the answer is still revealing.
  // Once the response is fully shown, it disappears.
  const showThinking = Boolean(thinking) && typewriter && isStreaming;

  return (
    <div className="rich-ai-message">
      <ThinkingLine active={showThinking} />
      <MarkdownBlocks content={visibleContent} citations={citations} />
      {isStreaming ? (
        <span className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-caret bg-[#1D79F2]" />
      ) : null}
    </div>
  );
}

function ThinkingLine({ active }: { active: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {active ? (
        <motion.div
          key="thinking-line"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.28, ease: "easeInOut" }}
          className="flex items-center gap-2 overflow-hidden text-xs font-medium"
        >
          <Brain className="size-3.5 shrink-0 animate-pulse text-[#1D79F2]" />
          <span className="thinking-text">Thinking</span>
          <span className="thinking-text inline-flex w-4 justify-start [animation-delay:0.4s]">…</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// Separates an optional <think>...</think> reasoning block from the answer body
// so reasoning never leaks into the rendered message.
function splitThinking(content: string): { thinking: string; answer: string } {
  const text = content ?? "";

  const closed = /<think>([\s\S]*?)<\/think>/i.exec(text);
  if (closed) {
    const before = text.slice(0, closed.index);
    const after = text.slice(closed.index + closed[0].length);
    return { thinking: closed[1].trim(), answer: `${before}${after}`.trim() };
  }

  // Unclosed block (e.g. still streaming): treat everything after <think> as reasoning.
  const open = /<think>([\s\S]*)$/i.exec(text);
  if (open) {
    return { thinking: open[1].trim(), answer: text.slice(0, open.index).trim() };
  }

  return { thinking: "", answer: text };
}

function revealWords(tokens: string[], visibleWords: number) {
  let wordsSeen = 0;
  let output = "";

  for (const token of tokens) {
    if (/\S/.test(token)) {
      if (wordsSeen >= visibleWords) {
        break;
      }
      wordsSeen += 1;
    }

    output += token;
  }

  return output;
}

function normalizeMarkdownContent(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\n```([a-zA-Z]+)/g, "\n```$1\n")
    .replace(/```([a-zA-Z]+)\n\n/g, "```$1\n");
}

function MarkdownBlocks({ content, citations }: { content: string; citations: CitationSource[] }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === "hr") {
          return <hr key={index} className="border-slate-200" />;
        }

        if (block.type === "heading") {
          const headingClass =
            block.level === 1
              ? "text-xl font-semibold leading-8 text-slate-950"
              : block.level === 2
                ? "text-lg font-semibold leading-7 text-slate-900"
                : block.level === 3
                  ? "text-base font-semibold leading-6 text-slate-800"
                  : "text-sm font-semibold leading-6 text-slate-800";

          return (
            <div key={index} className={headingClass}>
              {renderInline(block.content, citations)}
            </div>
          );
        }

        if (block.type === "code") {
          if (block.language === "chart") {
            return <ChartBlock key={index} source={block.content} />;
          }

          if (block.language === "mermaid") {
            return <MermaidCodeBlock key={index} source={block.content} />;
          }

          if (["json", "ipynb", "notebook", ""].includes(block.language)) {
            const cells = parseNotebook(block.content);
            if (cells) {
              return <NotebookBlock key={index} cells={cells} raw={block.content} citations={citations} />;
            }
          }

          return <CodeBlock key={index} code={block.content} language={block.language} />;
        }

        if (block.type === "table") {
          return <TableBlock key={index} rows={block.rows} citations={citations} />;
        }

        if (block.type === "list") {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, citations)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, citations)}</li>
              ))}
            </ol>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote key={index} className="border-l-2 border-[#1D79F2]/50 pl-3 text-slate-600">
              {renderInline(block.content, citations)}
            </blockquote>
          );
        }

        return (
          <p key={index} className="leading-6">
            {renderInline(block.content, citations)}
          </p>
        );
      })}
    </div>
  );
}

function parseBlocks(content: string) {
  const lines = normalizeMarkdownContent(content).split("\n");
  const blocks: Array<
    | { type: "paragraph"; content: string }
    | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: string }
    | { type: "hr" }
    | { type: "code"; language: string; content: string }
    | { type: "table"; rows: string[][] }
    | { type: "list"; items: string[] }
    | { type: "ordered-list"; items: string[] }
    | { type: "quote"; content: string }
  > = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: headingMatch[2],
      });
      continue;
    }

    const codeMatch = trimmed.match(/^```(\w+)?/);
    if (codeMatch) {
      const language = codeMatch[1] ?? "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", rows: parseTable(tableLines) });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    if (trimmed.startsWith(">")) {
      blocks.push({ type: "quote", content: trimmed.replace(/^>\s?/, "") });
      continue;
    }

    const paragraphLines = [trimmed];
    while (
      index + 1 < lines.length &&
      lines[index + 1].trim() &&
      !lines[index + 1].trim().match(/^(#{1,6}\s+|```|[-*]\s+|\d+\.\s+|>|-{3,}$|\*{3,}$|_{3,}$)/) &&
      !isTableStart(lines, index + 1)
    ) {
      index += 1;
      paragraphLines.push(lines[index].trim());
    }
    blocks.push({ type: "paragraph", content: paragraphLines.join(" ") });
  }

  return blocks;
}

function isTableStart(lines: string[], index: number) {
  return (
    lines[index]?.includes("|") &&
    Boolean(lines[index + 1]?.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/))
  );
}

function parseTable(lines: string[]) {
  return lines
    .filter((line) => !line.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
}

function TableBlock({ rows, citations }: { rows: string[][]; citations: CitationSource[] }) {
  const [head, ...body] = rows;

  if (!head) {
    return null;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            {head.map((cell, index) => (
              <th key={index} className="border-b border-slate-200 px-3 py-2 font-semibold">
                {renderInline(cell, citations)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-white even:bg-slate-50/70">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-slate-100 px-3 py-2 align-top">
                  {renderInline(cell, citations)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartBlock({ source }: { source: string }) {
  const chart = parseChart(source);

  if (!chart) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-50">
        <code>{source}</code>
      </pre>
    );
  }

  const maxValue = Math.max(...chart.values, 1);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {chart.title ? <p className="mb-3 text-sm font-semibold text-slate-800">{chart.title}</p> : null}
      <div className="space-y-2">
        {chart.labels.map((label, index) => {
          const value = chart.values[index] ?? 0;
          const width = `${Math.max(4, (value / maxValue) * 100)}%`;

          return (
            <div key={`${label}-${index}`} className="grid grid-cols-[96px_minmax(0,1fr)_48px] items-center gap-2 text-xs">
              <span className="truncate text-slate-500">{label}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#1D79F2]" style={{ width }} />
              </div>
              <span className="text-right font-medium text-slate-700">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type NotebookCell = {
  cellType: "code" | "markdown" | "raw";
  source: string;
  outputs?: string;
};

function joinSource(source: unknown): string {
  if (Array.isArray(source)) {
    return source.map((part) => (typeof part === "string" ? part : "")).join("");
  }
  return typeof source === "string" ? source : "";
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, "");
}

function extractOutputs(outputs: unknown): string | undefined {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  for (const output of outputs) {
    if (!output || typeof output !== "object") {
      continue;
    }

    const entry = output as Record<string, unknown>;
    if (entry.output_type === "stream") {
      parts.push(joinSource(entry.text));
    } else if (entry.output_type === "execute_result" || entry.output_type === "display_data") {
      const data = (entry.data as Record<string, unknown>) ?? {};
      if (data["text/plain"]) {
        parts.push(joinSource(data["text/plain"]));
      }
    } else if (entry.output_type === "error") {
      const traceback = Array.isArray(entry.traceback) ? (entry.traceback as string[]).join("\n") : "";
      parts.push(stripAnsi(traceback || `${entry.ename ?? "Error"}: ${entry.evalue ?? ""}`));
    }
  }

  const text = parts.join("\n").trim();
  return text || undefined;
}

// Detects a Jupyter notebook JSON payload and returns its cells, or null if the
// source is not a notebook (so it falls back to a normal code block).
function parseNotebook(source: string): NotebookCell[] | null {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const notebook = data as Record<string, unknown>;
  const rawCells = notebook.cells;
  if (!Array.isArray(rawCells)) {
    return null;
  }

  const looksLikeNotebook =
    typeof notebook.nbformat === "number" ||
    rawCells.some((cell) => cell && typeof (cell as Record<string, unknown>).cell_type === "string");
  if (!looksLikeNotebook) {
    return null;
  }

  const cells: NotebookCell[] = [];
  for (const rawCell of rawCells) {
    if (!rawCell || typeof rawCell !== "object") {
      continue;
    }

    const cell = rawCell as Record<string, unknown>;
    const cellType =
      cell.cell_type === "code" ? "code" : cell.cell_type === "markdown" ? "markdown" : "raw";
    const cellSource = joinSource(cell.source);

    if (!cellSource.trim() && cellType !== "code") {
      continue;
    }

    cells.push({
      cellType,
      source: cellSource,
      outputs: cellType === "code" ? extractOutputs(cell.outputs) : undefined,
    });
  }

  return cells.length > 0 ? cells : null;
}

function NotebookBlock({
  cells,
  raw,
  citations,
}: {
  cells: NotebookCell[];
  raw: string;
  citations: CitationSource[];
}) {
  const handleDownload = () => {
    try {
      const blob = new Blob([raw], { type: "application/x-ipynb+json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "notebook.ipynb";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Download is best-effort; ignore failures.
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold text-slate-700">
          Jupyter Notebook · {cells.length} {cells.length === 1 ? "cell" : "cells"}
        </span>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-[#1D79F2]/50 hover:text-[#1D79F2]"
          title="Download .ipynb"
        >
          <Download className="size-3.5" />
          <span>Download .ipynb</span>
        </button>
      </div>

      <div className="space-y-3 p-3">
        {cells.map((cell, index) =>
          cell.cellType === "code" ? (
            <NotebookCodeCell key={index} cell={cell} />
          ) : (
            <div
              key={index}
              className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm leading-6 text-slate-700"
            >
              <MarkdownBlocks content={cell.source} citations={citations} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function NotebookCodeCell({ cell }: { cell: NotebookCell }) {
  return (
    <div className="flex gap-2">
      <span className="select-none pt-2 font-mono text-[10px] leading-5 text-[#1D79F2]/70">In</span>
      <div className="min-w-0 flex-1 space-y-1">
        <CodeBlock code={cell.source} language="python" />
        {cell.outputs ? (
          <pre className="overflow-x-auto rounded-md border border-slate-100 bg-slate-50 p-2 text-[11px] leading-5 text-slate-600">
            <code>{cell.outputs}</code>
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <div className="group/code relative overflow-hidden rounded-lg bg-slate-950">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-5 text-slate-50">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MermaidCodeBlock({ source }: { source: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold text-slate-700">Mermaid ERD</span>
        <span className="text-[11px] text-slate-400">diagram source</span>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-5 text-slate-700">
        <code>{source}</code>
      </pre>
    </div>
  );
}

function parseChart(source: string): ChartData | null {
  try {
    const parsed = JSON.parse(source) as Partial<ChartData>;
    if (Array.isArray(parsed.labels) && Array.isArray(parsed.values)) {
      return {
        title: parsed.title,
        labels: parsed.labels.map(String),
        values: parsed.values.map(Number),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function renderInline(rawText: string, citations: CitationSource[] = []): ReactNode[] {
  const text = autoWrapBareLatex(rawText);
  const parts: ReactNode[] = [];
  const pattern =
    /(\$\$[^$]+\$\$|\$[^$\n]+\$|\[[^\]]+\]\(https?:\/\/[^)]+\)|\[\d+\]|`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith("$")) {
      const display = token.startsWith("$$");
      const inner = display ? token.slice(2, -2) : token.slice(1, -1);
      parts.push(
        display ? (
          <span key={key} className="my-1 block overflow-x-auto text-center font-mono text-[0.95em]">
            {renderMath(inner)}
          </span>
        ) : (
          <span key={key} className="inline-math">
            {renderMath(inner)}
          </span>
        ),
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.92em] text-slate-800">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("***")) {
      parts.push(
        <strong key={key} className="font-semibold">
          <em>{token.slice(3, -3)}</em>
        </strong>,
      );
    } else if (token.startsWith("**")) {
      parts.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.match(/^\[[^\]]+\]\(https?:\/\/[^)]+\)$/)) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      parts.push(
        <a
          key={key}
          href={linkMatch?.[2]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#1D79F2] underline decoration-[#1D79F2]/30 underline-offset-2"
        >
          {linkMatch?.[1]}
        </a>,
      );
    } else if (token.match(/^\[\d+\]$/)) {
      const citationId = Number(token.slice(1, -1));
      const citation = citations.find((source) => source.id === citationId);
      if (citation?.url) {
        parts.push(
          <a
            key={key}
            href={citation.url}
            target="_blank"
            rel="noreferrer"
            title={citation.title}
            className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-[#1D79F2]/10 px-1.5 text-[0.78em] font-semibold leading-5 text-[#1D79F2] no-underline"
          >
            {citationId}
          </a>,
        );
      } else {
        parts.push(
          <span
            key={key}
            title={citation?.title}
            className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[0.78em] font-semibold leading-5 text-slate-600"
          >
            {citationId}
          </span>,
        );
      }
    } else {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// Symbol commands (without the leading backslash) mapped to Unicode.
const LATEX_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ",
  Psi: "Ψ", Omega: "Ω",
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", oint: "∮", partial: "∂", nabla: "∇",
  infty: "∞", aleph: "ℵ",
  times: "×", cdot: "·", div: "÷", ast: "∗", star: "⋆", circ: "∘", bullet: "•", pm: "±", mp: "∓",
  oplus: "⊕", otimes: "⊗",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼",
  simeq: "≃", cong: "≅", propto: "∝", ll: "≪", gg: "≫", doteq: "≐",
  rightarrow: "→", to: "→", longrightarrow: "→", leftarrow: "←", longleftarrow: "←",
  leftrightarrow: "↔", Rightarrow: "⇒", implies: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔",
  iff: "⇔", uparrow: "↑", downarrow: "↓", mapsto: "↦",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
  cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", setminus: "∖",
  forall: "∀", exists: "∃", nexists: "∄", neg: "¬", lnot: "¬", land: "∧", wedge: "∧",
  lor: "∨", vee: "∨", therefore: "∴", because: "∵",
  cdots: "⋯", ldots: "…", dots: "…", vdots: "⋮", ddots: "⋱",
  angle: "∠", perp: "⊥", parallel: "∥", degree: "°", prime: "′", hbar: "ℏ", ell: "ℓ",
  Re: "ℜ", Im: "ℑ", surd: "√", checkmark: "✓",
  quad: " ", qquad: "  ", space: " ",
};

function unescapeText(source: string): string {
  return source.replace(/\\([%&$#_{}\s,;:])/g, (_match, character: string) =>
    character === "," || character === ";" || character === ":" ? " " : character.trim() ? character : " ",
  );
}

// Auto-wrap a paragraph that is clearly an equation but was emitted without $ delimiters.
function autoWrapBareLatex(text: string): string {
  if (text.includes("$")) {
    return text;
  }
  if (!/\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int)\b|\\text\{/.test(text)) {
    return text;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }
  const lead = text.slice(0, text.length - text.trimStart().length);
  const tail = text.slice(text.trimEnd().length);
  // Render a standalone bare equation as centered display math.
  return `${lead}$$${trimmed}$$${tail}`;
}

function renderMath(source: string): ReactNode {
  return <>{parseLatex(source, { value: 0 })}</>;
}

// A small recursive LaTeX-to-React renderer covering the common constructs:
// \frac, \sqrt, \text/\mathrm, subscripts, superscripts, symbols, and escapes.
function parseLatex(src: string, counter: { value: number }): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let i = 0;
  const nextKey = () => `tex-${counter.value++}`;
  const flush = () => {
    if (buffer) {
      nodes.push(buffer);
      buffer = "";
    }
  };

  const readGroup = (start: number): [string, number] => {
    let depth = 0;
    for (let j = start; j < src.length; j += 1) {
      if (src[j] === "{") {
        depth += 1;
      } else if (src[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          return [src.slice(start + 1, j), j + 1];
        }
      }
    }
    return [src.slice(start + 1), src.length];
  };

  const readArg = (start: number): [string, number] => {
    let j = start;
    while (j < src.length && src[j] === " ") {
      j += 1;
    }
    if (j >= src.length) {
      return ["", j];
    }
    if (src[j] === "{") {
      return readGroup(j);
    }
    if (src[j] === "\\") {
      let k = j + 1;
      while (k < src.length && /[a-zA-Z]/.test(src[k])) {
        k += 1;
      }
      if (k === j + 1) {
        k = j + 2;
      }
      return [src.slice(j, k), k];
    }
    return [src[j], j + 1];
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\") {
      let k = i + 1;
      while (k < src.length && /[a-zA-Z]/.test(src[k])) {
        k += 1;
      }
      const cmd = src.slice(i + 1, k);

      if (cmd === "") {
        const sym = src[i + 1] ?? "";
        if (sym === "\\") {
          flush();
          nodes.push(<br key={nextKey()} />);
          i += 2;
          continue;
        }
        const escaped: Record<string, string> = {
          "%": "%", "&": "&", $: "$", "#": "#", _: "_", "{": "{", "}": "}",
          " ": " ", ",": " ", ";": " ", ":": " ", "!": "",
        };
        buffer += escaped[sym] ?? sym;
        i += 2;
        continue;
      }

      i = k;

      if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
        const [num, ni] = readArg(i);
        const [den, di] = readArg(ni);
        i = di;
        flush();
        nodes.push(
          <MathFraction
            key={nextKey()}
            numerator={parseLatex(num, counter)}
            denominator={parseLatex(den, counter)}
          />,
        );
        continue;
      }

      if (cmd === "sqrt") {
        const [arg, ai] = readArg(i);
        i = ai;
        flush();
        nodes.push(
          <span key={nextKey()} className="inline-flex items-center">
            <span>√</span>
            <span className="border-t border-current">{parseLatex(arg, counter)}</span>
          </span>,
        );
        continue;
      }

      if (["text", "mathrm", "operatorname", "mathbf", "mathit", "mathsf", "textbf", "textit", "textrm"].includes(cmd)) {
        const [arg, ai] = readArg(i);
        i = ai;
        flush();
        const bold = cmd === "mathbf" || cmd === "textbf";
        const italic = cmd === "mathit" || cmd === "textit";
        const className = [bold ? "font-semibold" : "", italic ? "italic" : ""].filter(Boolean).join(" ");
        nodes.push(
          <span key={nextKey()} className={className || undefined}>
            {unescapeText(arg)}
          </span>,
        );
        continue;
      }

      if (
        ["left", "right", "bigl", "bigr", "big", "Big", "bigg", "Bigg", "displaystyle", "limits", "nolimits", "mathopen", "mathclose"].includes(
          cmd,
        )
      ) {
        continue;
      }

      const symbol = LATEX_SYMBOLS[cmd];
      if (symbol) {
        buffer += symbol;
        continue;
      }

      buffer += cmd;
      continue;
    }

    if (ch === "_" || ch === "^") {
      const [arg, ai] = readArg(i + 1);
      i = ai;
      flush();
      const inner = parseLatex(arg, counter);
      nodes.push(ch === "_" ? <sub key={nextKey()}>{inner}</sub> : <sup key={nextKey()}>{inner}</sup>);
      continue;
    }

    if (ch === "{") {
      const [group, gi] = readGroup(i);
      i = gi;
      flush();
      nodes.push(...parseLatex(group, counter));
      continue;
    }

    if (ch === "}") {
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return nodes;
}

function MathFraction({ numerator, denominator }: { numerator: ReactNode; denominator: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle text-[0.9em] leading-tight">
      <span className="px-1">{numerator}</span>
      <span className="w-full border-t border-current px-1 text-center">{denominator}</span>
    </span>
  );
}
