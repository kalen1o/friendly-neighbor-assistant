"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/message-bubble";
import type { Source } from "@/lib/api";

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
}

interface ChatMessagesProps {
  messages: DisplayMessage[];
  streamingContent: string;
  isLoading?: boolean;
}

export function ChatMessages({ messages, streamingContent, isLoading }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamingContent, isLoading]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} sources={msg.sources} />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-muted px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-current opacity-60 [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-current opacity-60 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-current opacity-60 [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        {streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} isStreaming />
        )}
      </div>
    </div>
  );
}
