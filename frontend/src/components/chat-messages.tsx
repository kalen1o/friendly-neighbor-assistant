"use client";

import { useCallback, useEffect, useRef } from "react";
import { MessageBubble } from "@/components/message-bubble";
import { Badge } from "@/components/ui/badge";
import { Globe, FileText, Pencil, Code, Sparkles, Calculator, Loader2 } from "lucide-react";
import type { Source, MessageMetrics } from "@/lib/api";

const EXPLAIN_CODE_PROMPT = "Explain how this code works:\n```\n\n```";

const SUGGESTIONS = [
  { icon: Globe, label: "Search the web", prompt: "Search the web for the latest news about AI" },
  { icon: FileText, label: "Summarize a document", prompt: "Summarize the key points from my uploaded documents" },
  { icon: Pencil, label: "Help me write", prompt: "Help me write a professional email about" },
  { icon: Code, label: "Explain code", prompt: EXPLAIN_CODE_PROMPT, cursorOffset: EXPLAIN_CODE_PROMPT.indexOf("\n\n") + 1 },
  { icon: Calculator, label: "Do a calculation", prompt: "Calculate " },
  { icon: Sparkles, label: "Brainstorm ideas", prompt: "Brainstorm 5 creative ideas for " },
];

export function EmptyState({ onSuggestionClick }: { onSuggestionClick: (content: string, cursorOffset?: number) => void }) {
  return (
    <div className="flex flex-col items-center">
      <img src="/small-logo.png" alt="Friendly Neighbor" className="mb-3 h-14 w-14 rounded-2xl" />
      <h2 className="mb-1 text-lg font-semibold">What can I help you with?</h2>
      <p className="mb-8 text-sm text-muted-foreground">
        Ask me anything, or try one of these
      </p>
      <div className="grid w-full max-w-lg grid-cols-1 sm:grid-cols-2 gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => onSuggestionClick(s.prompt, s.cursorOffset)}
            className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 text-left text-sm transition-all hover:border-primary/30 hover:bg-accent hover:shadow-sm"
          >
            <s.icon className="h-4 w-4 shrink-0 text-primary/70" />
            <span className="text-muted-foreground">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

let _msgId = 0;
export function nextMsgId() { return `msg-${++_msgId}`; }

export interface AttachedFile {
  url: string;
  name: string;
  type: string; // MIME type
}

export interface SkillUsage {
  name: string;
  params?: Record<string, unknown>;
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
  skillsUsed?: SkillUsage[] | null;
  metrics?: MessageMetrics | null;
  files?: AttachedFile[];
}

interface ChatMessagesProps {
  messages: DisplayMessage[];
  streamingContent: string;
  isLoading?: boolean;
  actionText?: string | null;
  activeSkills?: SkillUsage[];
  onEditMessage?: (index: number, newContent: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

function SkillBadges({ skills }: { skills: SkillUsage[] }) {
  const seen = new Set<string>();
  const unique = skills.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
  if (!unique.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5 pl-1">
      {unique.map((skill) => {
        const hasParams = skill.params && Object.keys(skill.params).length > 0;
        return (
          <span key={skill.name} className="group/skill relative">
            <Badge
              variant="secondary"
              className="gap-1 text-[10px] cursor-default transition-colors group-hover/skill:bg-accent"
            >
              <span className="h-1 w-1 rounded-full bg-primary" />
              {skill.name.replace(/_/g, " ")}
            </Badge>
            {hasParams && (
              <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden w-max max-w-sm rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md group-hover/skill:block">
                {Object.entries(skill.params!).map(([k, v]) => (
                  <div key={k} className="break-all">
                    <span className="font-medium text-muted-foreground">{k}:</span>{" "}
                    {String(v)}
                  </div>
                ))}
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}


export function ChatMessages({ messages, streamingContent, isLoading, actionText, activeSkills = [], onEditMessage, hasMore, loadingMore, onLoadMore }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(messages.length);
  const isLoadingOlderRef = useRef(false);

  // Auto-scroll to bottom only for new messages (not when prepending older ones)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (isLoadingOlderRef.current) {
      // Older messages were prepended — restore scroll position
      isLoadingOlderRef.current = false;
    } else {
      // New message appended or streaming — scroll to bottom
      el.scrollTop = el.scrollHeight;
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, streamingContent, isLoading, actionText]);

  // Preserve scroll position when older messages are prepended
  const handleLoadMore = useCallback(() => {
    if (!onLoadMore || loadingMore) return;
    const el = scrollRef.current;
    if (!el) return;
    const prevScrollHeight = el.scrollHeight;
    isLoadingOlderRef.current = true;

    // Wait for DOM update after messages prepend, then restore scroll
    const observer = new MutationObserver(() => {
      observer.disconnect();
      el.scrollTop = el.scrollHeight - prevScrollHeight;
    });
    observer.observe(el, { childList: true, subtree: true });

    onLoadMore();
  }, [onLoadMore, loadingMore]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          handleLoadMore();
        }
      },
      { root: container, threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, loadingMore, handleLoadMore]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-2 py-4 md:p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {/* Sentinel for infinite scroll */}
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-2">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={msg.id} className="animate-message-in">
            {msg.role === "assistant" && msg.skillsUsed && msg.skillsUsed.length > 0 && (
              <SkillBadges skills={msg.skillsUsed} />
            )}
            <MessageBubble
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              metrics={msg.role === "assistant" ? msg.metrics : undefined}
              onEdit={msg.role === "user" && onEditMessage ? (newContent) => onEditMessage(i, newContent) : undefined}
              files={msg.files}
              messageId={msg.id}
            />
          </div>
        ))}
        {streamingContent && (
          <div>
            {activeSkills.length > 0 && <SkillBadges skills={activeSkills} />}
            <MessageBubble role="assistant" content={streamingContent} isStreaming />
          </div>
        )}
        {(isLoading || actionText) && !streamingContent && (
          <div className="flex animate-fade-in-up justify-start">
            <div className="rounded-[20px] rounded-bl-md border border-border/60 bg-card px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:300ms]" />
                </span>
                {actionText && <span className="animate-fade-in text-xs">{actionText}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
