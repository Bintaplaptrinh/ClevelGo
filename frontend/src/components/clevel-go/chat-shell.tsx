"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  BarChart3,
  Library,
  MessageSquare,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  Sparkles,
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
};

type ApiMessage = {
  id: string;
  role: Role | "system";
  content: string;
  createdAt: string;
  status?: "completed" | "failed";
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
};

type AgentResponse = {
  conversationId: string;
  content: string;
  messages: ApiMessage[];
  conversation: ConversationSummary;
};

type ChatShellProps = {
  onAgentRequest?: (request: AgentRequest) => Promise<AgentResponse>;
};

const conversationStorageKey = "clevel-go-conversation-id";

const starterMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Good morning. I can help inspect schemas, reason through pipeline failures, profile datasets, and prepare SQL or dbt-ready transformations.",
  },
];

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

async function requestAgentResponse({ message, conversationId }: AgentRequest): Promise<AgentResponse> {
  const response = await fetch(`${apiBaseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, conversationId }),
  });

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

function mapApiMessages(messages: ApiMessage[]): Message[] {
  const chatMessages = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: message.id,
      role: message.role as Role,
      content: message.content,
      isTyping: false,
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
    const nextConversations = await requestConversations();
    setConversations(nextConversations);
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
    conversationIdRef.current = conversationId;
    safeSetConversationId(conversationId);
    setActiveConversationId(conversationId);
    setComposerDocked(true);
    setIsThinking(false);

    const history = await requestConversationHistory(conversationId);
    setMessages(mapApiMessages(history.messages));
    await refreshConversations();
  };

  useEffect(() => {
    const loadInitialState = async () => {
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

  const sendMessage = async (message: string) => {
    const activeConversationId = getConversationId();

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };

    setMessages((current) => [...current, userMessage]);
    setIsThinking(true);

    try {
      const response = await onAgentRequest({ message, conversationId: activeConversationId });
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

            <div className="flex items-center gap-2">
              <button className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500" title="Settings">
                <Settings2 className="size-4" />
              </button>
            </div>
          </header>

          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(29,121,242,0.12),transparent_28%),radial-gradient(circle_at_78%_72%,rgba(21,214,161,0.1),transparent_24%)]" />

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
                  {greeting}. How can I <span className="text-[#1D79F2]">assist your data work</span> today?
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
                      className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                        message.role === "user"
                          ? "bg-[#1D79F2] text-white"
                          : "w-full border border-slate-100 bg-white/88 text-slate-700 backdrop-blur-xl"
                      }`}
                    >
                      {message.role === "assistant" && message.isTyping ? (
                        <RichAiMessage content={message.content} typewriter />
                      ) : message.role === "assistant" ? (
                        <RichAiMessage content={message.content} />
                      ) : (
                        message.content
                      )}
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
}: {
  conversation: ConversationSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg px-3 py-2 text-left transition ${
        active ? "bg-[#1D79F2]/10 text-[#1D79F2]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      }`}
      title={conversation.title}
    >
      <span className="block truncate text-xs font-medium">{conversation.title}</span>
      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
        {conversation.lastMessagePreview || `${conversation.messageCount} messages`}
      </span>
    </button>
  );
}
