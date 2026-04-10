"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChatMessages, EmptyState, type DisplayMessage } from "@/components/chat-messages";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import { getChat, sendMessage, type Source, type MessageMetrics, type ChatMode } from "@/lib/api";
import { useAuth } from "@/components/auth-guard";
import { toast } from "sonner";

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { requireAuth } = useAuth();
  const chatId = params.id as string;
  const initialQuerySent = useRef(false);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionText, setActionText] = useState<string | null>(null);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const chatInputRef = useRef<ChatInputHandle>(null);

  // Accumulated text from SSE chunks (full received text)
  const fullTextRef = useRef("");
  // How many characters have been revealed by the typewriter
  const revealedRef = useRef(0);
  // Whether the SSE stream has finished
  const doneRef = useRef(false);
  // Typewriter interval ID
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Sources received from SSE for the current response
  const sourcesRef = useRef<Source[] | null>(null);
  // Metrics received from SSE for the current response
  const metricsRef = useRef<MessageMetrics | null>(null);
  // Skills used during the current response
  const skillsUsedRef = useRef<string[]>([]);

  const stopTypewriter = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const finalizeMessage = useCallback(() => {
    stopTypewriter();
    const finalContent = fullTextRef.current;
    const allSources = sourcesRef.current || [];
    const realSources = allSources.filter((s) => s.type !== "skill");
    const finalSkills = [...skillsUsedRef.current];
    const finalMetrics = metricsRef.current;
    if (finalContent) {
      setMessages((msgs) => [
        ...msgs,
        { role: "assistant", content: finalContent, sources: realSources.length > 0 ? realSources : null, skillsUsed: finalSkills.length > 0 ? finalSkills : null, metrics: finalMetrics },
      ]);
    }
    setStreamingContent("");
    setActiveSkills([]);
    fullTextRef.current = "";
    revealedRef.current = 0;
    doneRef.current = false;
    sourcesRef.current = null;
    metricsRef.current = null;
    skillsUsedRef.current = [];
    setIsStreaming(false);
  }, [stopTypewriter]);

  const startTypewriter = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      const full = fullTextRef.current;
      const revealed = revealedRef.current;

      if (revealed < full.length) {
        // Advance to next word boundary
        const behind = full.length - revealed;
        const wordsPerTick = behind > 200 ? Math.ceil(behind / 15) : behind > 50 ? 2 : 1;
        let next = revealed;
        for (let w = 0; w < wordsPerTick && next < full.length; w++) {
          // Skip whitespace
          while (next < full.length && /\s/.test(full[next])) next++;
          // Skip to end of word
          while (next < full.length && !/\s/.test(full[next])) next++;
        }
        revealedRef.current = next;
        setStreamingContent(full.slice(0, next));
      } else if (doneRef.current) {
        finalizeMessage();
      }
    }, 30);
  }, [finalizeMessage]);

  // Clean up interval on unmount
  useEffect(() => stopTypewriter, [stopTypewriter]);

  const loadChat = useCallback(async () => {
    try {
      const chat = await getChat(chatId);
      setMessages(
        chat.messages.map((m) => {
          const allSources = m.sources || [];
          const realSources = allSources.filter((s) => s.type !== "skill");
          const skills = allSources
            .filter((s) => s.type === "skill" && s.tool)
            .map((s) => s.tool!);
          return {
            role: m.role as "user" | "assistant",
            content: m.content,
            sources: realSources.length > 0 ? realSources : null,
            skillsUsed: skills.length > 0 ? skills : null,
            metrics: m.metrics || null,
          };
        })
      );
    } catch (e) {
      toast.error("Chat not found");
      router.replace("/");
    }
  }, [chatId]);

  useEffect(() => {
    loadChat().then(() => {
      // Auto-send message from URL query param (from home page)
      const q = searchParams.get("q");
      const mode = (searchParams.get("mode") || "balanced") as ChatMode;
      if (q && !initialQuerySent.current) {
        initialQuerySent.current = true;
        // Clean the URL
        router.replace(`/chat/${chatId}`);
        handleSend(q, mode);
      }
    });
  }, [loadChat]);

  const handleSend = async (content: string, mode: ChatMode = "balanced") => {
    const authed = await requireAuth();
    if (!authed) return;

    setMessages((prev) => [...prev, { role: "user", content }]);
    setStreamingContent("");
    fullTextRef.current = "";
    revealedRef.current = 0;
    doneRef.current = false;
    sourcesRef.current = null;
    metricsRef.current = null;
    skillsUsedRef.current = [];
    setActiveSkills([]);
    setIsStreaming(true);
    setIsLoading(true);
    setActionText(null);

    sendMessage(chatId, content, {
      onAction: (action) => {
        setActionText(action);
        setIsLoading(true);
        const match = action.match(/^Using (\w+)/);
        if (match) {
          const skillName = match[1];
          if (!skillsUsedRef.current.includes(skillName)) {
            skillsUsedRef.current.push(skillName);
            setActiveSkills([...skillsUsedRef.current]);
          }
        }
      },
      onMetrics: (metrics) => {
        metricsRef.current = metrics;
      },
      onSources: (sources) => {
        sourcesRef.current = sources;
      },
      onMessage: (chunk) => {
        setIsLoading(false);
        fullTextRef.current += chunk;
        startTypewriter();
      },
      onTitle: () => {
        window.dispatchEvent(new Event("chat-title-updated"));
      },
      onDone: () => {
        doneRef.current = true;
        setIsLoading(false);
        setActionText(null);
        // If typewriter already caught up, finalize now
        if (!intervalRef.current) {
          finalizeMessage();
        }
      },
      onError: (err) => {
        stopTypewriter();
        toast.error(err);
        setStreamingContent("");
        fullTextRef.current = "";
        revealedRef.current = 0;
        doneRef.current = false;
        setIsLoading(false);
        setActionText(null);
        setIsStreaming(false);
      },
    }, mode);
  };

  const isEmpty = messages.length === 0 && !streamingContent && !isLoading && !actionText;
  const [showSuggestions, setShowSuggestions] = useState(true);

  // Keep suggestions visible briefly during the slide-down transition
  useEffect(() => {
    if (!isEmpty) {
      const timer = setTimeout(() => setShowSuggestions(false), 500);
      return () => clearTimeout(timer);
    }
    setShowSuggestions(true);
  }, [isEmpty]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">

      {!isEmpty && (
        <ChatMessages
          messages={messages}
          streamingContent={streamingContent}
          isLoading={isLoading}
          actionText={actionText}
          activeSkills={activeSkills}
          onEditMessage={(index, newContent) => {
            setMessages((prev) => prev.slice(0, index));
            handleSend(newContent);
          }}
        />
      )}

      {/* Top spacer: pushes content to center when empty, collapses when not */}
      <div
        className="transition-[flex-grow] duration-500 ease-out"
        style={{ flexGrow: isEmpty ? 1 : 0 }}
      />

      {/* Suggestions: fade out when not empty */}
      {showSuggestions && (
        <div className={`flex justify-center overflow-hidden transition-[opacity,max-height] duration-300 ${isEmpty ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"}`}>
          <EmptyState onSuggestionClick={(text, cur) => chatInputRef.current?.setInput(text, cur)} />
        </div>
      )}

      <div className={`transition-[padding] duration-500 ${isEmpty ? "pt-6" : "pt-0"}`}>
        <ChatInput ref={chatInputRef} onSend={handleSend} disabled={isStreaming} transparent={isEmpty} />
      </div>

      {/* Bottom spacer: mirrors top spacer to keep content centered */}
      <div
        className="transition-[flex-grow] duration-500 ease-out"
        style={{ flexGrow: isEmpty ? 1 : 0 }}
      />
    </div>
  );
}
