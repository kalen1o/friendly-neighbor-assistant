"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nextMsgId, type DisplayMessage, type SkillUsage } from "@/components/chat-messages";
import type { PendingFile } from "@/components/chat-input";
import {
  getChat,
  listArtifacts,
  type Source,
  type MessageMetrics,
  type ChatMode,
  type ArtifactData,
  type MessageOut,
} from "@/lib/api";
import { toast } from "sonner";
import { startStream, reattachStream, hasActiveStream, setViewingChat } from "@/lib/active-streams";

export function useMessageStream(chatId: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuerySent = useRef(false);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionText, setActionText] = useState<string | null>(null);
  const [activeSkills, setActiveSkills] = useState<SkillUsage[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<Array<{ name: string; status: string; parallel?: boolean }>>([]);
  const [artifacts, setArtifacts] = useState<ArtifactData[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactData | null>(null);
  const [chatModelId, setChatModelId] = useState<string | null>(null);

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
  const skillsUsedRef = useRef<SkillUsage[]>([]);
  const sendingRef = useRef(false);
  const streamingArtifactRef = useRef<{
    title: string;
    template: string;
    files: Record<string, string>;
  } | null>(null);
  const chatTitleRef = useRef<string>("");
  const bgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopBgPoll = useCallback(() => {
    if (bgPollRef.current) {
      clearInterval(bgPollRef.current);
      bgPollRef.current = null;
    }
  }, []);

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
    // Merge params from sources into skills
    const skillSources = allSources.filter((s) => s.type === "skill" && s.tool);
    const finalSkills: SkillUsage[] = skillSources.length > 0
      ? skillSources.map((s) => ({ name: s.tool!, params: s.params }))
      : [...skillsUsedRef.current];
    const finalMetrics = metricsRef.current;
    if (finalContent) {
      setMessages((msgs) => [
        ...msgs,
        {
          id: nextMsgId(),
          role: "assistant",
          content: finalContent,
          sources: realSources.length > 0 ? realSources : null,
          skillsUsed: finalSkills.length > 0 ? finalSkills : null,
          metrics: finalMetrics,
        },
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

  // Track which chat the user is viewing (suppresses toast for active chat)
  useEffect(() => {
    setViewingChat(chatId);
    return () => setViewingChat(null);
  }, [chatId]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      stopTypewriter();
      stopBgPoll();
    };
  }, [stopTypewriter, stopBgPoll]);

  const mapMessages = useCallback((msgs: MessageOut[]): DisplayMessage[] => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return msgs.map((m) => {
      const allSources = m.sources || [];
      const realSources = allSources.filter((s) => s.type !== "skill");
      const skills: SkillUsage[] = allSources
        .filter((s) => s.type === "skill" && s.tool)
        .map((s) => ({ name: s.tool!, params: s.params }));
      const attachedFiles = m.files?.map((f) => ({
        url: `${apiBase}/api/uploads/${f.id}`,
        name: f.name,
        type: f.type,
      }));
      return {
        id: m.id || nextMsgId(),
        role: m.role as "user" | "assistant",
        content: m.content,
        sources: realSources.length > 0 ? realSources : null,
        skillsUsed: skills.length > 0 ? skills : null,
        metrics: m.metrics || null,
        files: attachedFiles && attachedFiles.length > 0 ? attachedFiles : undefined,
      };
    });
  }, []);

  const loadChat = useCallback(async () => {
    // Don't overwrite messages while a send is in progress
    if (sendingRef.current) return;

    // Check if there's an active stream for this chat (user navigated back)
    if (hasActiveStream(chatId)) {
      const accumulated = reattachStream(chatId, {
        onAction: (action) => {
          setActionText(action);
          setIsLoading(true);
        },
        onMessage: (chunk) => {
          setIsLoading(false);
          fullTextRef.current += chunk;
          startTypewriter();
        },
        onTitle: (title) => {
          chatTitleRef.current = title;
          window.dispatchEvent(new Event("chat-title-updated"));
        },
        onSources: (sources) => { sourcesRef.current = sources; },
        onMetrics: (metrics) => { metricsRef.current = metrics; },
        onArtifact: (artifact) => {
          setArtifacts([artifact]);
          setActiveArtifact(artifact);
        },
        onArtifactStart: (data) => {
          streamingArtifactRef.current = {
            title: data.title,
            template: data.template,
            files: {},
          };
          const placeholder: ArtifactData = {
            id: `streaming-${Date.now()}`,
            type: "project",
            title: data.title,
            template: data.template,
            files: {},
            dependencies: {},
          };
          setActiveArtifact(placeholder);
        },
        onArtifactFile: (data) => {
          if (!streamingArtifactRef.current) return;
          streamingArtifactRef.current.files[data.path] = data.code;
          setActiveArtifact((prev) => {
            if (!prev || !prev.id.startsWith("streaming-")) return prev;
            return {
              ...prev,
              files: { ...streamingArtifactRef.current!.files },
            };
          });
        },
        onArtifactEnd: () => {
          streamingArtifactRef.current = null;
        },
        onWorkflow: (steps) => { setWorkflowSteps(steps); },
        onWorkflowStep: (step) => {
          setWorkflowSteps((prev) =>
            prev.map((s) => s.name === step.name ? { ...s, status: step.status } : s)
          );
        },
        onDone: () => {
          doneRef.current = true;
          setIsLoading(false);
          setActionText(null);
          setWorkflowSteps([]);
          if (!intervalRef.current) finalizeMessage();
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
      });
      if (accumulated !== null) {
        // Resume showing the accumulated text
        sendingRef.current = true;
        setIsStreaming(true);
        setIsLoading(false);
        fullTextRef.current = accumulated;
        revealedRef.current = 0;
        startTypewriter();
        setChatLoading(false);
        // Still load the chat to get existing messages
        try {
          const chat = await getChat(chatId, 20);
          // Filter out the last user message (it's already shown by doSend)
          setMessages(mapMessages(chat.messages));
          setChatModelId(chat.model_id ?? null);
          chatTitleRef.current = chat.title || "";
        } catch { /* ignore */ }
        return;
      }
    }
    try {
      const chat = await getChat(chatId, 20);
      setMessages(mapMessages(chat.messages));
      setHasMoreMessages(chat.has_more ?? false);
      nextCursorRef.current = chat.next_cursor ?? null;
      setChatModelId(chat.model_id ?? null);
      chatTitleRef.current = chat.title || "";

      // Check if last message is still generating (e.g. after page reload)
      const lastMsg = chat.messages[chat.messages.length - 1];
      if (lastMsg?.status === "generating") {
        // Show the partial message with a streaming cursor (no extra loading bubble)
        setIsStreaming(true);
        fullTextRef.current = lastMsg.content || "";
        revealedRef.current = fullTextRef.current.length;
        setStreamingContent(fullTextRef.current);

        // Poll every 3 seconds until generation completes
        const pollInterval = setInterval(async () => {
          try {
            const updated = await getChat(chatId, 20);
            const updatedLast = updated.messages[updated.messages.length - 1];
            if (updatedLast?.status === "generating") {
              // Update partial content in place
              const mapped = mapMessages(updated.messages);
              // Remove the generating message from the list — we show it via streamingContent
              const withoutLast = mapped.slice(0, -1);
              setMessages(withoutLast);
              fullTextRef.current = updatedLast.content || "";
              revealedRef.current = fullTextRef.current.length;
              setStreamingContent(fullTextRef.current);
            } else {
              stopBgPoll();
              setMessages(mapMessages(updated.messages));
              setStreamingContent("");
              fullTextRef.current = "";
              revealedRef.current = 0;
              setIsStreaming(false);
              setIsLoading(false);
              setActionText(null);
              chatTitleRef.current = updated.title || "";
            }
          } catch {
            stopBgPoll();
            setStreamingContent("");
            fullTextRef.current = "";
            revealedRef.current = 0;
            setIsStreaming(false);
            setIsLoading(false);
            setActionText(null);
          }
        }, 3000);

        // Remove the generating message from displayed list — show via streamingContent instead
        const mapped = mapMessages(chat.messages);
        setMessages(mapped.slice(0, -1));

        // Store interval ref for cleanup
        bgPollRef.current = pollInterval;
      }

      listArtifacts(chatId)
        .then((arts) => {
          if (arts.length === 0) return;
          // Keep only the latest artifact
          const latest = arts[arts.length - 1];
          setArtifacts([
            {
              id: latest.id,
              type: "project" as const,
              title: latest.title,
              template: latest.template ?? "react",
              files: latest.files ?? {},
              dependencies: latest.dependencies ?? {},
            },
          ]);
        })
        .catch(() => {});
    } catch (e) {
      const msg = (e as Error).message || "";
      // Only redirect on actual 404, not on transient network/CORS errors
      if (msg.includes("Failed to get chat")) {
        toast.error("Chat not found");
        router.replace("/");
      } else {
        // Network error — retry once after a short delay
        console.warn("Chat load failed, retrying...", msg);
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const chat = await getChat(chatId, 20);
          setMessages(mapMessages(chat.messages));
          setHasMoreMessages(chat.has_more ?? false);
          nextCursorRef.current = chat.next_cursor ?? null;
          setChatModelId(chat.model_id ?? null);
          chatTitleRef.current = chat.title || "";
        } catch {
          toast.error("Failed to load chat");
          router.replace("/");
        }
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatId, mapMessages, router]);

  const loadOlderMessages = useCallback(async () => {
    if (!nextCursorRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const chat = await getChat(chatId, 20, nextCursorRef.current);
      const older = mapMessages(chat.messages);
      setMessages((prev) => [...older, ...prev]);
      setHasMoreMessages(chat.has_more ?? false);
      nextCursorRef.current = chat.next_cursor ?? null;
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [chatId, loadingMore, mapMessages]);

  const doSend = useCallback(
    (content: string, mode: ChatMode = "balanced", files: PendingFile[] = []) => {
      sendingRef.current = true;
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const attachedFiles = files.map((f) => ({
        url: f.previewUrl || `${apiBase}/api/uploads/${f.id}`,
        name: f.filename,
        type: f.file_type,
      }));
      setMessages((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: "user",
          content,
          files: attachedFiles.length > 0 ? attachedFiles : undefined,
        },
      ]);
      const fileIds = files.map((f) => f.id);
      // Stop any background poll from a previous generating message
      stopBgPoll();
      setStreamingContent("");
      fullTextRef.current = "";
      revealedRef.current = 0;
      doneRef.current = false;
      sourcesRef.current = null;
      metricsRef.current = null;
      skillsUsedRef.current = [];
      setActiveSkills([]);
      setWorkflowSteps([]);
      setIsStreaming(true);
      setIsLoading(true);
      setActionText(null);

      const artCtx = activeArtifact && !activeArtifact.id.startsWith("streaming-")
        ? { files: activeArtifact.files, template: activeArtifact.template, title: activeArtifact.title }
        : undefined;

      startStream(
        chatId,
        content,
        mode,
        fileIds,
        chatTitleRef.current,
        {
          onAction: (action) => {
            setActionText(action);
            setIsLoading(true);
            const match = action.match(/^Using (\w+)/);
            if (match) {
              const skillName = match[1];
              const params = action.includes("query=") ? { query: action.split("query=")[1] } : undefined;
              if (!skillsUsedRef.current.some((s) => s.name === skillName)) {
                skillsUsedRef.current.push({ name: skillName, params });
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
            setArtifacts([artifact]);
            setActiveArtifact(artifact);
          },
          onArtifactStart: (data) => {
            streamingArtifactRef.current = {
              title: data.title,
              template: data.template,
              files: {},
            };
            const placeholder: ArtifactData = {
              id: `streaming-${Date.now()}`,
              type: "project",
              title: data.title,
              template: data.template,
              files: {},
              dependencies: {},
            };
            setActiveArtifact(placeholder);
          },
          onArtifactFile: (data) => {
            if (!streamingArtifactRef.current) return;
            streamingArtifactRef.current.files[data.path] = data.code;
            const filesCopy = { ...streamingArtifactRef.current.files };
            setActiveArtifact((prev) => {
              if (!prev || !prev.id.startsWith("streaming-")) return prev;
              return {
                ...prev,
                files: filesCopy,
              };
            });
          },
          onArtifactEnd: () => {
            streamingArtifactRef.current = null;
          },
          onWorkflow: (steps) => {
            setWorkflowSteps(steps);
          },
          onWorkflowStep: (step) => {
            setWorkflowSteps((prev) =>
              prev.map((s) => s.name === step.name ? { ...s, status: step.status } : s)
            );
          },
          onMessage: (chunk) => {
            setIsLoading(false);
            fullTextRef.current += chunk;
            startTypewriter();
          },
          onTitle: (title) => {
            chatTitleRef.current = title;
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
        },
        artCtx
      );
    },
    [chatId, startTypewriter, finalizeMessage, stopTypewriter, stopBgPoll, activeArtifact]
  );

  const fixArtifactError = useCallback((error: string) => {
    if (!activeArtifact || activeArtifact.id.startsWith("streaming-")) return;
    const fixPrompt = `Fix this runtime error in the artifact "${activeArtifact.title}":\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease generate a corrected version of the project.`;
    doSend(fixPrompt, "balanced" as ChatMode, []);
  }, [activeArtifact, doSend]);

  // Initial load / auto-send from URL
  useEffect(() => {
    const q = searchParams.get("q");
    const mode = (searchParams.get("mode") || "balanced") as ChatMode;

    if (q && !initialQuerySent.current) {
      // Auto-send from URL — skip loadChat since the chat is empty
      initialQuerySent.current = true;
      setChatLoading(false);
      router.replace(`/chat/${chatId}`);
      doSend(q, mode);
    } else if (!initialQuerySent.current || !sendingRef.current) {
      loadChat();
    }
  }, [loadChat]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    messages,
    setMessages,
    chatLoading,
    hasMoreMessages,
    loadingMore,
    streamingContent,
    isStreaming,
    isLoading,
    actionText,
    activeSkills,
    workflowSteps,
    artifacts,
    setArtifacts,
    activeArtifact,
    setActiveArtifact,
    chatModelId,
    setChatModelId,
    loadOlderMessages,
    doSend,
    fixArtifactError,
  };
}
