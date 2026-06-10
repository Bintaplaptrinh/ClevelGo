"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  BarChart3,
  CloudSun,
  Clock3,
  Droplets,
  ExternalLink,
  FileText,
  Library,
  Link as LinkIcon,
  MessageSquare,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Wind,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { FluidChatComposer } from "@/components/clevel-go/fluid-chat-composer";
import { RichAiMessage } from "@/components/clevel-go/rich-ai-message";
import { AnimatedInput } from "@/components/smoothui/ui/AnimatedInput";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
  isTyping?: boolean;
  citations?: CitationSource[];
  widgets?: ChatWidget[];
  attachments?: AttachmentSummary[];
};

type CitationSource = {
  id: number;
  title: string;
  url?: string | null;
  snippet: string;
  sourceType: "web" | "url" | "file";
};

type WeatherForecast = {
  date: string;
  condition: string;
  max: number;
  min: number;
};

type WidgetDataValue = string | number | boolean | null | WeatherForecast[];

type ChatWidget = {
  widgetType: "time" | "weather";
  title: string;
  data: Record<string, WidgetDataValue>;
};

type AttachmentSummary = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  summary: string;
};

type ApiMessage = {
  id: string;
  role: Role | "system";
  content: string;
  createdAt: string;
  status?: "completed" | "failed";
  citations?: CitationSource[];
  widgets?: ChatWidget[];
  attachments?: AttachmentSummary[];
};

type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
  pinned: boolean;
  archived: boolean;
};

type AgentRequest = {
  message: string;
  conversationId: string;
  files?: File[];
  clientTimezone?: string;
};

type AgentResponse = {
  conversationId: string;
  content: string;
  messages: ApiMessage[];
  conversation: ConversationSummary;
  citations?: CitationSource[];
  widgets?: ChatWidget[];
  attachments?: AttachmentSummary[];
};

type ChatShellProps = {
  onAgentRequest?: (request: AgentRequest) => Promise<AgentResponse>;
};

const conversationStorageKey = "clevel-go-conversation-id";

const starterMessages: Message[] = [];

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

function safeGetConversationId() {
  try {
    return window.localStorage.getItem(conversationStorageKey);
  } catch {
    return null;
  }
}

function safeSetConversationId(conversationId: string) {
  try {
    window.localStorage.setItem(conversationStorageKey, conversationId);
  } catch {
    // The in-memory ref still keeps the active chat usable when storage is unavailable.
  }
}

function safeRemoveConversationId() {
  try {
    window.localStorage.removeItem(conversationStorageKey);
  } catch {
    // Local storage may be unavailable in private or embedded browser contexts.
  }
}

async function requestAgentResponse({
  message,
  conversationId,
  files = [],
  clientTimezone = getClientTimezone(),
}: AgentRequest): Promise<AgentResponse> {
  const requestInit: RequestInit =
    files.length > 0
      ? {
          method: "POST",
          body: buildChatFormData(message, conversationId, files, clientTimezone),
        }
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message, conversationId, clientTimezone }),
        };

  const response = await fetch(`${apiBaseUrl}/api/chat`, requestInit);

  if (!response.ok) {
    let detail = "Agent request failed";
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail ?? detail;
    } catch {
      // Keep the default message when the backend response is not JSON.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<AgentResponse>;
}

function getClientTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function buildChatFormData(message: string, conversationId: string, files: File[], clientTimezone?: string) {
  const formData = new FormData();
  formData.set("message", message);
  formData.set("conversationId", conversationId);
  if (clientTimezone) {
    formData.set("clientTimezone", clientTimezone);
  }
  files.forEach((file) => formData.append("files", file));
  return formData;
}

async function requestConversations(): Promise<ConversationSummary[]> {
  const response = await fetch(`${apiBaseUrl}/api/conversations`);

  if (!response.ok) {
    throw new Error("Conversation list request failed");
  }

  const payload = (await response.json()) as { conversations: ConversationSummary[] };
  return payload.conversations;
}

async function requestConversationHistory(conversationId: string) {
  const response = await fetch(`${apiBaseUrl}/api/conversations/${conversationId}`);

  if (!response.ok) {
    throw new Error("Conversation history request failed");
  }

  return response.json() as Promise<{
    conversationId: string;
    conversation: ConversationSummary | null;
    messages: ApiMessage[];
  }>;
}

async function requestDeleteConversation(conversationId: string) {
  const response = await fetch(`${apiBaseUrl}/api/conversations/${conversationId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Conversation delete request failed");
  }
}

function mapApiMessages(messages: ApiMessage[]): Message[] {
  const chatMessages = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: message.id,
      role: message.role as Role,
      content: message.content,
      isTyping: false,
      citations: message.citations ?? [],
      widgets: message.widgets ?? [],
      attachments: message.attachments ?? [],
    }));

  return chatMessages.length > 0 ? chatMessages : starterMessages;
}

export function ChatShell({ onAgentRequest = requestAgentResponse }: ChatShellProps) {
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [composerDocked, setComposerDocked] = useState(false);
  const [showGoBottom, setShowGoBottom] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [search, setSearch] = useState("");
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLElement | null>(null);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();

    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  }, []);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(query));
  }, [conversations, search]);

  const refreshConversations = async () => {
    try {
      const nextConversations = await requestConversations();
      setConversations(nextConversations);
    } catch {
      setConversations([]);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  };

  const handleChatScroll = () => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowGoBottom(distanceFromBottom > 220);
  };

  useEffect(() => {
    window.requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages.length]);

  const openConversation = async (conversationId: string) => {
    try {
      conversationIdRef.current = conversationId;
      safeSetConversationId(conversationId);
      setActiveConversationId(conversationId);
      setComposerDocked(true);
      setIsThinking(false);

      const history = await requestConversationHistory(conversationId);
      setMessages(mapApiMessages(history.messages));
      await refreshConversations();
    } catch {
      conversationIdRef.current = null;
      safeRemoveConversationId();
      setActiveConversationId(null);
      setComposerDocked(false);
      setMessages(starterMessages);
    }
  };

  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const nextConversations = await requestConversations();
        setConversations(nextConversations);

        const storedConversationId = safeGetConversationId();
        const hasStoredConversation = nextConversations.some(
          (conversation) => conversation.id === storedConversationId,
        );

        if (storedConversationId && hasStoredConversation) {
          const history = await requestConversationHistory(storedConversationId);
          conversationIdRef.current = storedConversationId;
          setActiveConversationId(storedConversationId);
          setComposerDocked(true);
          setMessages(mapApiMessages(history.messages));
        }
      } catch {
        setConversations([]);
      }
    };

    void loadInitialState();
  }, []);

  const startNewConversation = () => {
    const nextConversationId = crypto.randomUUID();

    conversationIdRef.current = nextConversationId;
    safeSetConversationId(nextConversationId);
    setActiveConversationId(nextConversationId);
    setComposerDocked(false);
    setShowGoBottom(false);
    setMessages(starterMessages);
    setIsThinking(false);
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      await requestDeleteConversation(conversationId);
    } catch {
      return;
    }

    setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));

    if (conversationIdRef.current === conversationId || activeConversationId === conversationId) {
      conversationIdRef.current = null;
      safeRemoveConversationId();
      setActiveConversationId(null);
      setComposerDocked(false);
      setShowGoBottom(false);
      setMessages(starterMessages);
      setIsThinking(false);
    }
  };

  const getConversationId = () => {
    if (conversationIdRef.current) {
      return conversationIdRef.current;
    }

    const storedConversationId = safeGetConversationId();
    const nextConversationId = storedConversationId ?? crypto.randomUUID();

    conversationIdRef.current = nextConversationId;
    safeSetConversationId(nextConversationId);

    return nextConversationId;
  };

  const sendMessage = async (message: string, files: File[] = []) => {
    const activeConversationId = getConversationId();
    const optimisticAttachments = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      summary: "Queued for analysis",
    }));

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      attachments: optimisticAttachments,
    };

    setMessages((current) => [...current, userMessage]);
    setIsThinking(true);

    try {
      const response = await onAgentRequest({
        message,
        conversationId: activeConversationId,
        files,
        clientTimezone: getClientTimezone(),
      });
      conversationIdRef.current = response.conversationId;
      safeSetConversationId(response.conversationId);
      setActiveConversationId(response.conversationId);
      setComposerDocked(true);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.content,
          isTyping: true,
          citations: response.citations ?? [],
          widgets: response.widgets ?? [],
        },
      ]);
      setConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id),
      ]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown backend error";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `I could not reach the agent service.\n\n---\n\nBackend detail: ${detail}`,
          isTyping: true,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <main className="h-screen overflow-hidden bg-white text-slate-950">
      <div className="grid h-full min-w-0 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen border-r border-slate-100 bg-white/90 px-5 py-6 lg:flex lg:flex-col">
          <div className="mb-7 flex items-center gap-3">
            <Image
              src="/clevelgo_logo.jpg"
              alt="Clevel Go logo"
              width={34}
              height={34}
              priority
              className="rounded-lg"
            />
            <div>
              <p className="text-sm font-semibold">Clevel Go</p>
            </div>
          </div>

          <AnimatedInput
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon={<Search className="size-4" />}
          />

          <nav className="mt-6 space-y-1 text-sm">
            <button
              type="button"
              onClick={startNewConversation}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <Plus className="size-4" />
              <span>New Chat</span>
            </button>
            {[
              ["Explore", BarChart3, "/explore"],
              ["Library", Library, "/library"],
            ].map(([label, Icon, href]) => (
              <Link
                key={String(label)}
                href={href as string}
                className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <Icon className="size-4" />
                <span>{label as string}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-8 min-h-0 flex-1 overflow-y-auto pr-1">
            <p className="px-3 text-xs font-medium text-slate-400">History</p>
            <div className="mt-2 space-y-1">
              {filteredConversations.length > 0 ? (
                filteredConversations.map((conversation) => (
                  <ConversationButton
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeConversationId}
                    onClick={() => void openConversation(conversation.id)}
                    onDelete={() => void deleteConversation(conversation.id)}
                  />
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-slate-400">No conversations yet</p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-white text-[#1D79F2] shadow-sm">
                <MessageSquare className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">{conversations.length} conversations</p>
              </div>
            </div>
          </div>
        </aside>

        <section
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="relative flex h-screen min-w-0 flex-col overflow-y-auto overflow-x-hidden"
        >
          <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-100 bg-white/84 px-4 backdrop-blur-xl sm:px-7">
            <div className="flex items-center gap-2">
              <button className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 lg:hidden" title="Menu">
                <PanelLeft className="size-4" />
              </button>
            </div>

            <div className="relative flex items-center gap-2">
              <button
                type="button"
                className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-[#1D79F2]/40 hover:text-[#1D79F2]"
                title="Settings"
                aria-label="Settings"
                onClick={() => setShowSettingsPopup((current) => !current)}
              >
                <Settings2 className="size-4" />
              </button>
              {showSettingsPopup ? (
                <div className="absolute right-0 top-11 z-30 rounded-xl border border-white/70 bg-white/78 px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_18px_52px_rgba(15,23,42,0.16)] backdrop-blur-2xl">
                  Coming soon
                </div>
              ) : null}
            </div>
          </header>

          <div className="relative flex flex-1 flex-col px-4 pb-36 pt-8 sm:px-8">
            <div className="mx-0 w-full min-w-0 sm:mx-auto" style={{ maxWidth: "min(56rem, calc(100vw - 32px))" }}>
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", duration: 0.45, bounce: 0.12 }}
                className="mb-8 text-center"
              >
                <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-white shadow-[0_18px_60px_rgba(29,121,242,0.18)]">
                  <Image
                    src="/clevelgo_logo.jpg"
                    alt="Clevel Go logo"
                    width={46}
                    height={46}
                    className="rounded-xl"
                    priority
                  />
                </div>
                <h1
                  className="mx-auto text-balance text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl"
                  style={{ maxWidth: "min(45rem, calc(100vw - 32px))" }}
                >
                  {greeting}. How can I <span className="text-[#1D79F2]">assist your work</span> today?
                </h1>
              </motion.div>

              <div className="space-y-4">
                {messages.map((message) => (
                  <motion.article
                    key={message.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", duration: 0.35, bounce: 0.08 }}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`relative max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                        message.role === "user"
                          ? "bg-[#1D79F2] text-white"
                          : `w-full border border-slate-100 bg-white/88 text-slate-700 backdrop-blur-xl ${
                              (message.citations?.length ?? 0) > 0 ? "pb-11" : ""
                            }`
                      }`}
                    >
                      {message.role === "assistant" ? <WidgetDeck widgets={message.widgets ?? []} /> : null}
                      {message.role === "user" ? <AttachmentList attachments={message.attachments ?? []} compact /> : null}
                      {message.role === "assistant" && message.isTyping ? (
                        <RichAiMessage content={message.content} citations={message.citations ?? []} typewriter />
                      ) : message.role === "assistant" ? (
                        <RichAiMessage content={message.content} citations={message.citations ?? []} />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                      {message.role === "assistant" ? <SourceDock sources={message.citations ?? []} /> : null}
                    </div>
                  </motion.article>
                ))}

                {isThinking ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-sm text-slate-400"
                  >
                    <span className="grid size-7 place-items-center rounded-full border border-[#1D79F2]/20 bg-white text-[#1D79F2]">
                      <Sparkles className="size-3.5 animate-pulse" />
                    </span>
                    Thinking through the request
                  </motion.div>
                ) : null}
              </div>
            </div>
          </div>

          {showGoBottom ? (
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="fixed bottom-28 right-5 z-40 grid size-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-[0_14px_40px_rgba(15,23,42,0.16)] transition hover:border-[#1D79F2]/50 hover:text-[#1D79F2]"
              title="Go to bottom"
              aria-label="Go to bottom"
            >
              <ArrowDown className="size-4" />
            </button>
          ) : null}

          <FluidChatComposer
            key={composerDocked ? "docked-composer" : "center-composer"}
            forceDocked={composerDocked}
            isThinking={isThinking}
            onSubmit={sendMessage}
          />
        </section>
      </div>
    </main>
  );
}

function ConversationButton({
  conversation,
  active,
  onClick,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          onClick();
        }}
        className={`block w-full rounded-lg px-3 py-2 pr-9 text-left transition ${
          active ? "bg-[#1D79F2]/10 text-[#1D79F2]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        }`}
        title={conversation.title}
      >
        <span className="block truncate text-xs font-medium">{conversation.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-400">
          {conversation.lastMessagePreview || `${conversation.messageCount} messages`}
        </span>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((current) => !current);
        }}
        className={`absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-md text-sm font-semibold transition ${
          menuOpen ? "bg-white text-slate-700 shadow-sm" : "text-slate-400 hover:bg-white hover:text-slate-700"
        }`}
        aria-label="Conversation options"
        title="Conversation options"
      >
        :
      </button>

      {menuOpen ? (
        <div className="absolute right-1.5 top-8 z-20 w-28 rounded-lg border border-white/70 bg-white/90 p-1 shadow-[0_16px_44px_rgba(15,23,42,0.16)] backdrop-blur-xl">
          <button
            type="button"
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-xs font-medium text-red-600 transition hover:bg-red-50"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentList({ attachments, compact = false }: { attachments: AttachmentSummary[]; compact?: boolean }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={`mb-2 flex flex-wrap gap-2 ${compact ? "justify-end" : ""}`}>
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${
            compact ? "bg-white/15 text-white" : "border border-slate-200 bg-white text-slate-600"
          }`}
          title={attachment.summary || attachment.name}
        >
          <FileText className="size-3.5 shrink-0" />
          <span className="max-w-[220px] truncate">{attachment.name}</span>
          <span className={compact ? "text-white/70" : "text-slate-400"}>{formatBytes(attachment.size)}</span>
        </span>
      ))}
    </div>
  );
}

function SourceDock({ sources }: { sources: CitationSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-2 right-2 z-10">
      <div className="group/source relative">
        <button
          type="button"
          className="relative grid size-8 place-items-center rounded-full border border-slate-200/80 bg-white/88 text-slate-500 shadow-sm backdrop-blur-xl transition hover:border-[#1D79F2]/40 hover:text-[#1D79F2] focus:outline-none focus:ring-2 focus:ring-[#1D79F2]/20"
          aria-label={`${sources.length} sources`}
          title="Sources"
        >
          <LinkIcon className="size-4" />
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[#1D79F2] px-1 text-[10px] font-semibold leading-4 text-white">
            {sources.length}
          </span>
        </button>

        <div className="pointer-events-none absolute bottom-10 right-0 w-[min(23rem,calc(100vw-3rem))] translate-y-1 opacity-0 transition duration-150 group-hover/source:pointer-events-auto group-hover/source:translate-y-0 group-hover/source:opacity-100 group-focus-within/source:pointer-events-auto group-focus-within/source:translate-y-0 group-focus-within/source:opacity-100">
          <div className="max-h-72 overflow-y-auto rounded-xl border border-white/70 bg-white/78 p-2.5 text-left shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
            <div className="sticky top-0 z-10 mb-2 flex items-center justify-between rounded-lg bg-white/80 px-2 py-1.5 backdrop-blur-xl">
              <span className="text-xs font-semibold text-slate-700">Sources</span>
              <span className="text-[11px] text-slate-400">{sources.length}</span>
            </div>
            <div className="space-y-1.5">
              {sources.map((source) => {
                const content = (
                  <span className="flex min-w-0 items-start gap-2 rounded-lg border border-slate-200/80 bg-white/72 p-2 transition hover:border-[#1D79F2]/40 hover:bg-white">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#1D79F2]/10 text-[11px] font-semibold text-[#1D79F2]">
                      {source.id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-xs font-semibold leading-5 text-slate-800">
                        {source.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {source.url ? displayUrl(source.url) : source.sourceType}
                      </span>
                    </span>
                    {source.url ? <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-slate-400" /> : null}
                  </span>
                );

                return source.url ? (
                  <a key={`${source.id}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">
                    {content}
                  </a>
                ) : (
                  <span key={`${source.id}-${source.title}`}>{content}</span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WidgetDeck({ widgets }: { widgets: ChatWidget[] }) {
  if (widgets.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      {widgets.map((widget, index) =>
        widget.widgetType === "weather" ? (
          <WeatherWidget key={`${widget.title}-${index}`} widget={widget} />
        ) : (
          <TimeWidget key={`${widget.title}-${index}`} widget={widget} />
        ),
      )}
    </div>
  );
}

function TimeWidget({ widget }: { widget: ChatWidget }) {
  const timezone = getWidgetString(widget.data.timezone);
  const fallbackTime = getWidgetString(widget.data.time);
  const fallbackDate = getWidgetString(widget.data.date);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = getClockParts(now, timezone, fallbackTime);
  const dateLabel = formatWidgetDate(now, timezone, fallbackDate);
  const hourDegree = ((clock.hour % 12) + clock.minute / 60) * 30;
  const minuteDegree = (clock.minute + clock.second / 60) * 6;
  const secondDegree = clock.second * 6;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.45, bounce: 0.12 }}
      className="overflow-hidden rounded-xl border border-slate-200 bg-[linear-gradient(135deg,#ffffff,#eef6ff)] p-4 text-slate-800 shadow-sm"
    >
      <div className="flex items-center gap-4">
        <div className="relative grid size-20 shrink-0 place-items-center rounded-full border border-white/80 bg-white/82 shadow-[inset_0_0_0_6px_rgba(29,121,242,0.06),0_14px_34px_rgba(29,121,242,0.14)] backdrop-blur-xl">
          <span className="absolute top-1.5 text-[9px] font-semibold text-slate-400">12</span>
          <span className="absolute bottom-1.5 text-[9px] font-semibold text-slate-400">6</span>
          <span className="absolute left-2 text-[9px] font-semibold text-slate-400">9</span>
          <span className="absolute right-2 text-[9px] font-semibold text-slate-400">3</span>
          <span
            className="absolute left-1/2 top-1/2 h-6 w-1 origin-bottom rounded-full bg-slate-700 transition-transform duration-300"
            style={{ transform: `translate(-50%, -100%) rotate(${hourDegree}deg)` }}
          />
          <span
            className="absolute left-1/2 top-1/2 h-7 w-0.5 origin-bottom rounded-full bg-[#1D79F2] transition-transform duration-300"
            style={{ transform: `translate(-50%, -100%) rotate(${minuteDegree}deg)` }}
          />
          <span
            className="absolute left-1/2 top-1/2 h-8 w-px origin-bottom rounded-full bg-[#15D6A1] transition-transform duration-300"
            style={{ transform: `translate(-50%, -100%) rotate(${secondDegree}deg)` }}
          />
          <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1D79F2]" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Clock3 className="size-4 text-[#1D79F2]" />
            <span className="truncate">{getWidgetString(widget.data.location) || widget.title}</span>
          </div>
          <p className="mt-2 font-mono text-3xl font-semibold leading-none text-slate-950">{clock.display}</p>
          <p className="mt-1 text-xs text-slate-500">{dateLabel}</p>
          <p className="mt-2 truncate text-[11px] text-slate-400">{timezone}</p>
        </div>
      </div>
    </motion.div>
  );
}

function WeatherWidget({ widget }: { widget: ChatWidget }) {
  const condition = getWidgetString(widget.data.condition) || "Current";
  const forecast = getWeatherForecast(widget.data.forecast);
  const temperature = getWidgetNumber(widget.data.temperature);
  const humidity = getWidgetNumber(widget.data.humidity);
  const windSpeed = getWidgetNumber(widget.data.windSpeed);
  const temperatureUnit = getWidgetString(widget.data.temperatureUnit) || "C";
  const windSpeedUnit = getWidgetString(widget.data.windSpeedUnit) || "km/h";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.45, bounce: 0.12 }}
      className="overflow-hidden rounded-xl border border-sky-100 bg-[linear-gradient(135deg,#f7fbff,#e7fff6)] p-4 text-slate-800 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <CloudSun className="size-4 text-[#15D6A1]" />
            <span className="truncate">{getWidgetString(widget.data.location) || widget.title}</span>
          </div>
          <p className="mt-3 text-4xl font-semibold leading-none text-slate-950">
            {temperature}
            <span className="text-lg">&deg;{temperatureUnit}</span>
          </p>
          <p className="mt-1 text-xs font-semibold text-emerald-700">{condition}</p>
        </div>

        <WeatherAnimation condition={condition} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1 rounded-lg bg-white/68 px-2 py-1.5">
          <Droplets className="size-3.5 text-[#1D79F2]" />
          {humidity}% humidity
        </span>
        <span className="inline-flex items-center gap-1 rounded-lg bg-white/68 px-2 py-1.5">
          <Wind className="size-3.5 text-[#15D6A1]" />
          {windSpeed} {windSpeedUnit}
        </span>
      </div>

      {forecast.length > 0 ? (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {forecast.map((day) => (
            <div key={day.date} className="rounded-lg bg-white/68 p-2 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.65)]">
              <p className="text-[11px] font-semibold text-slate-500">{formatForecastDay(day.date)}</p>
              <p className="mt-1 text-xs font-semibold text-slate-800">{weatherSymbol(day.condition)}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {Math.round(day.max)}&deg;/{Math.round(day.min)}&deg;
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}

function WeatherAnimation({ condition }: { condition: string }) {
  const lowered = condition.toLowerCase();
  const isRain = lowered.includes("rain") || lowered.includes("drizzle") || lowered.includes("thunderstorm");
  const isSnow = lowered.includes("snow");
  const isCloudy = lowered.includes("cloud") || lowered.includes("fog");

  return (
    <div className="relative grid size-20 shrink-0 place-items-center rounded-2xl bg-white/62 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]">
      <motion.span
        className="absolute size-10 rounded-full bg-[#FFD166]"
        animate={{ rotate: 360, scale: isCloudy ? [1, 0.95, 1] : [1, 1.08, 1] }}
        transition={{ rotate: { duration: 16, repeat: Infinity, ease: "linear" }, scale: { duration: 2.8, repeat: Infinity } }}
      />
      <motion.span
        className="absolute bottom-5 left-5 h-7 w-11 rounded-full bg-white shadow-[0_8px_18px_rgba(15,23,42,0.12)]"
        animate={{ x: isCloudy ? [0, 3, 0] : [0, 1, 0] }}
        transition={{ duration: 3.2, repeat: Infinity }}
      />
      <motion.span
        className="absolute bottom-7 left-4 size-7 rounded-full bg-white"
        animate={{ x: isCloudy ? [0, 2, 0] : [0, 1, 0] }}
        transition={{ duration: 3.2, repeat: Infinity }}
      />
      {(isRain || isSnow) ? (
        <span className="absolute bottom-2 left-6 right-6 flex justify-between">
          {[0, 1, 2].map((drop) => (
            <motion.span
              key={drop}
              className={`block ${isSnow ? "size-1.5 rounded-full bg-sky-200" : "h-3 w-0.5 rounded-full bg-[#1D79F2]"}`}
              animate={{ y: [0, 8, 0], opacity: [0.25, 0.95, 0.25] }}
              transition={{ duration: 0.95, repeat: Infinity, delay: drop * 0.18 }}
            />
          ))}
        </span>
      ) : null}
    </div>
  );
}

function displayUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getWidgetString(value: WidgetDataValue | undefined) {
  return typeof value === "string" ? value : "";
}

function getWidgetNumber(value: WidgetDataValue | undefined) {
  if (typeof value === "number") {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }
  return 0;
}

function getWeatherForecast(value: WidgetDataValue | undefined): WeatherForecast[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item) =>
        item &&
        typeof item.date === "string" &&
        typeof item.condition === "string" &&
        typeof item.max === "number" &&
        typeof item.min === "number",
    )
    .slice(0, 4);
}

function getClockParts(now: Date, timezone: string, fallbackTime: string) {
  const formatted = formatTimeWithParts(now, timezone);
  if (formatted) {
    return formatted;
  }

  const fallbackMatch = fallbackTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (fallbackMatch) {
    const hour = Number(fallbackMatch[1]);
    const minute = Number(fallbackMatch[2]);
    const second = Number(fallbackMatch[3] ?? now.getSeconds());
    return {
      hour,
      minute,
      second,
      display: `${padClock(hour)}:${padClock(minute)}:${padClock(second)}`,
    };
  }

  return {
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
    display: `${padClock(now.getHours())}:${padClock(now.getMinutes())}:${padClock(now.getSeconds())}`,
  };
}

function formatTimeWithParts(now: Date, timezone: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      ...(timezone ? { timeZone: timezone } : {}),
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    const second = Number(parts.second);

    if ([hour, minute, second].every(Number.isFinite)) {
      return {
        hour,
        minute,
        second,
        display: `${padClock(hour)}:${padClock(minute)}:${padClock(second)}`,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function formatWidgetDate(now: Date, timezone: string, fallbackDate: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(now);
  } catch {
    return fallbackDate;
  }
}

function formatForecastDay(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date.slice(5) || date;
  }
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(parsed);
}

function weatherSymbol(condition: string) {
  const lowered = condition.toLowerCase();
  if (lowered.includes("rain") || lowered.includes("drizzle") || lowered.includes("thunderstorm")) {
    return "Rain";
  }
  if (lowered.includes("snow")) {
    return "Snow";
  }
  if (lowered.includes("cloud") || lowered.includes("fog")) {
    return "Cloud";
  }
  return "Clear";
}

function padClock(value: number) {
  return String(Math.max(0, value)).padStart(2, "0");
}
