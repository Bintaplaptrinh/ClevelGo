"use client";

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
  const normalizedContent = useMemo(() => normalizeMarkdownContent(content), [content]);
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

  const visibleContent = typewriter ? revealWords(tokens, visibleWords) : normalizedContent;

  return (
    <div className="rich-ai-message">
      <MarkdownBlocks content={visibleContent} citations={citations} />
      {typewriter && visibleWords < totalWords ? (
        <span className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-caret bg-[#1D79F2]" />
      ) : null}
    </div>
  );
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

          return (
            <pre key={index} className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-50">
              <code>{block.content}</code>
            </pre>
          );
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

function renderInline(text: string, citations: CitationSource[] = []): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\$[^$\n]+\$|\[[^\]]+\]\(https?:\/\/[^)]+\)|\[\d+\]|`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith("$")) {
      parts.push(
        <span key={key} className="inline-math">
          {renderInlineMath(token.slice(1, -1))}
        </span>,
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

function renderInlineMath(source: string) {
  const replacements: Record<string, string> = {
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\epsilon": "ε",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\pi": "π",
    "\\sigma": "σ",
    "\\theta": "θ",
    "\\omega": "ω",
    "\\rightarrow": "→",
    "\\to": "→",
    "\\leftarrow": "←",
    "\\leftrightarrow": "↔",
    "\\Rightarrow": "⇒",
    "\\Leftarrow": "⇐",
    "\\Leftrightarrow": "⇔",
    "\\uparrow": "↑",
    "\\downarrow": "↓",
    "\\times": "×",
    "\\cdot": "·",
    "\\div": "÷",
    "\\pm": "±",
    "\\le": "≤",
    "\\leq": "≤",
    "\\ge": "≥",
    "\\geq": "≥",
    "\\ne": "≠",
    "\\neq": "≠",
    "\\approx": "≈",
    "\\equiv": "≡",
    "\\infty": "∞",
  };

  return source.replace(/\\[A-Za-z]+/g, (command) => replacements[command] ?? command);
}
