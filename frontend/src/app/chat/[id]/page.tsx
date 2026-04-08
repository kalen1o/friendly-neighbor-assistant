"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ChatMessages, type DisplayMessage } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { getChat, sendMessage } from "@/lib/api";

const CHAR_INTERVAL_MS = 12; // ms per character for typewriter effect

export default function ChatPage() {
  const params = useParams();
  const chatId = Number(params.id);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Full text received so far from SSE
  const fullTextRef = useRef("");
  // How many characters have been revealed to the UI
  const revealedRef = useRef(0);
  // Whether the SSE stream has finished
  const doneRef = useRef(false);
  // Typewriter interval ID
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTypewriter = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTypewriter = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      const full = fullTextRef.current;
      const revealed = revealedRef.current;

      if (revealed < full.length) {
        // Reveal next character(s) — speed up if we're falling behind
        const behind = full.length - revealed;
        const step = behind > 80 ? Math.ceil(behind / 10) : 1;
        const next = Math.min(revealed + step, full.length);
        revealedRef.current = next;
        setStreamingContent(full.slice(0, next));
      } else if (doneRef.current) {
        // All characters revealed and stream is done — finalize
        stopTypewriter();
        const finalContent = fullTextRef.current;
        if (finalContent) {
          setMessages((msgs) => [
            ...msgs,
            { role: "assistant", content: finalContent },
          ]);
        }
        setStreamingContent("");
        fullTextRef.current = "";
        revealedRef.current = 0;
        doneRef.current = false;
        setIsStreaming(false);
      }
    }, CHAR_INTERVAL_MS);
  }, [stopTypewriter]);

  // Clean up interval on unmount
  useEffect(() => stopTypewriter, [stopTypewriter]);

  const loadChat = useCallback(async () => {
    try {
      const chat = await getChat(chatId);
      setMessages(
        chat.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
      setError(null);
    } catch (e) {
      setError("Failed to load chat");
      console.error(e);
    }
  }, [chatId]);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  const handleSend = (content: string) => {
    setMessages((prev) => [...prev, { role: "user", content }]);
    setStreamingContent("");
    fullTextRef.current = "";
    revealedRef.current = 0;
    doneRef.current = false;
    setIsStreaming(true);
    setIsLoading(true);
    setError(null);

    sendMessage(chatId, content, {
      onMessage: (chunk) => {
        setIsLoading(false);
        fullTextRef.current += chunk;
        startTypewriter();
      },
      onTitle: () => {},
      onDone: () => {
        doneRef.current = true;
        setIsLoading(false);
        // If typewriter isn't running (no chunks received), finalize now
        if (!intervalRef.current) {
          setIsStreaming(false);
        }
      },
      onError: (err) => {
        stopTypewriter();
        setError(err);
        setStreamingContent("");
        fullTextRef.current = "";
        revealedRef.current = 0;
        doneRef.current = false;
        setIsLoading(false);
        setIsStreaming(false);
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <ChatMessages messages={messages} streamingContent={streamingContent} isLoading={isLoading} />
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
