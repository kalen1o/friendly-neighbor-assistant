"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ChatMessages, type DisplayMessage } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { getChat, sendMessage, type Source, type MessageMetrics } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

const CHAR_INTERVAL_MS = 12; // ms per character for typewriter effect

export default function ChatPage() {
  const params = useParams();
  const chatId = Number(params.id);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionText, setActionText] = useState<string | null>(null);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Full text received so far from SSE
  const fullTextRef = useRef("");
  // How many characters have been revealed to the UI
  const revealedRef = useRef(0);
  // Whether the SSE stream has finished
  const doneRef = useRef(false);
  // Sources received from SSE for the current response
  const sourcesRef = useRef<Source[] | null>(null);
  // Metrics received from SSE for the current response
  const metricsRef = useRef<MessageMetrics | null>(null);
  // Skills used during the current response
  const skillsUsedRef = useRef<string[]>([]);
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
        sourcesRef.current = null;
        metricsRef.current = null;
        skillsUsedRef.current = [];
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
    sourcesRef.current = null;
    metricsRef.current = null;
    skillsUsedRef.current = [];
    setActiveSkills([]);
    setIsStreaming(true);
    setIsLoading(true);
    setActionText(null);
    setError(null);

    sendMessage(chatId, content, {
      onAction: (action) => {
        setActionText(action);
        // Track skill usage from "Using skillname..." actions
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
        setActionText(null);
        fullTextRef.current += chunk;
        startTypewriter();
      },
      onTitle: () => {},
      onDone: () => {
        doneRef.current = true;
        setIsLoading(false);
        setActionText(null);
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
        setActionText(null);
        setIsStreaming(false);
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ChatMessages
        messages={messages}
        streamingContent={streamingContent}
        isLoading={isLoading}
        actionText={actionText}
        activeSkills={activeSkills}
        onEditMessage={(index, newContent) => {
          // Trim messages after the edited one, then re-send
          setMessages((prev) => prev.slice(0, index));
          handleSend(newContent);
        }}
      />
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
