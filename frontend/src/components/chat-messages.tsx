"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/message-bubble";
import { Badge } from "@/components/ui/badge";
import type { Source, MessageMetrics } from "@/lib/api";

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
  skillsUsed?: string[] | null;
  metrics?: MessageMetrics | null;
}

interface ChatMessagesProps {
  messages: DisplayMessage[];
  streamingContent: string;
  isLoading?: boolean;
  actionText?: string | null;
  activeSkills?: string[];
  onEditMessage?: (index: number, newContent: string) => void;
}

function SkillBadges({ skills }: { skills: string[] }) {
  const unique = [...new Set(skills)];
  if (!unique.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pl-1">
      {unique.map((skill) => (
        <Badge key={skill} variant="secondary" className="gap-1 text-[10px]">
          <span className="h-1 w-1 rounded-full bg-primary" />
          {skill.replace(/_/g, " ")}
        </Badge>
      ))}
    </div>
  );
}


export function ChatMessages({ messages, streamingContent, isLoading, actionText, activeSkills = [], onEditMessage }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamingContent, isLoading, actionText]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "assistant" && msg.skillsUsed && msg.skillsUsed.length > 0 && (
              <SkillBadges skills={msg.skillsUsed} />
            )}
            <MessageBubble
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              metrics={msg.role === "assistant" ? msg.metrics : undefined}
              onEdit={msg.role === "user" && onEditMessage ? (newContent) => onEditMessage(i, newContent) : undefined}
            />
          </div>
        ))}
        {(isLoading || actionText) && (
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
        {streamingContent && (
          <div>
            {activeSkills.length > 0 && <SkillBadges skills={activeSkills} />}
            <MessageBubble role="assistant" content={streamingContent} isStreaming />
          </div>
        )}
      </div>
    </div>
  );
}
