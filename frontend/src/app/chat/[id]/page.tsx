"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Share2 } from "lucide-react";
import { ChatMessages, EmptyState, type DisplayMessage } from "@/components/chat-messages";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "@/components/share-dialog";
import { getChat, sendMessage, listArtifacts, type Source, type MessageMetrics, type ChatMode, type ArtifactData } from "@/lib/api";
import { ArtifactPanel } from "@/components/artifact-panel";
import { ArtifactCard } from "@/components/artifact-card";
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
  const [shareOpen, setShareOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactData[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactData | null>(null);

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
    sendingRef.current = false;
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

  const sendingRef = useRef(false);

  const loadChat = useCallback(async () => {
    // Don't overwrite messages while a send is in progress
    if (sendingRef.current) return;
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
      listArtifacts(chatId).then(arts => {
        setArtifacts(arts.map(a => ({
          id: a.id,
          type: (a.artifact_type || a.type) as "react" | "html",
          title: a.title,
          code: a.code,
        })));
      }).catch(() => {});
    } catch (e) {
      toast.error("Chat not found");
      router.replace("/");
    }
  }, [chatId]);

  const doSend = (content: string, mode: ChatMode = "balanced") => {
    sendingRef.current = true; // eslint-disable-line react-hooks/immutability -- ref is intentionally mutable
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
      onArtifact: (artifact) => {
        setArtifacts(prev => [...prev, artifact]);
        setActiveArtifact(artifact);
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
        sendingRef.current = false;
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

  useEffect(() => {
    const q = searchParams.get("q");
    const mode = (searchParams.get("mode") || "balanced") as ChatMode;

    if (q && !initialQuerySent.current) {
      // Auto-send from URL — skip loadChat since the chat is empty
      initialQuerySent.current = true;
      router.replace(`/chat/${chatId}`);
      doSend(q, mode);
    } else if (!initialQuerySent.current || !sendingRef.current) {
      loadChat();
    }
  }, [loadChat]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async (content: string, mode: ChatMode = "balanced") => {
    const authed = await requireAuth();
    if (!authed) {
      chatInputRef.current?.setInput(content);
      return;
    }
    doSend(content, mode);
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
    <div className="flex min-h-0 flex-1">
      <div className={`flex flex-col min-h-0 overflow-hidden ${activeArtifact ? "w-1/2" : "w-full"}`}>

        {!isEmpty && (
          <div className="flex items-center justify-end px-4 py-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShareOpen(true)}
              title="Share conversation"
            >
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        )}

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

        {!isEmpty && artifacts.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-2">
            {artifacts.map(a => (
              <ArtifactCard
                key={a.id}
                artifact={a}
                onClick={() => setActiveArtifact(a)}
              />
            ))}
          </div>
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

        <ShareDialog
          chatId={chatId}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      </div>

      {activeArtifact && (
        <div className="w-1/2 h-full">
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setActiveArtifact(null)}
            onCodeChange={(id, code) => {
              setArtifacts(prev =>
                prev.map(a => (a.id === id ? { ...a, code } : a))
              );
              setActiveArtifact(prev =>
                prev && prev.id === id ? { ...prev, code } : prev
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
