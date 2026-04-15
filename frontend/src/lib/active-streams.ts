/**
 * Global manager for active SSE streams.
 * Keeps LLM responses running even when the user navigates to another chat.
 * The backend saves progressively, so responses survive navigation.
 */

import { sendMessage, type ChatMode, type Source, type MessageMetrics, type ArtifactData } from "@/lib/api";
import { toast } from "sonner";

interface ActiveStream {
  chatId: string;
  abort: () => void;
  fullText: string;
  done: boolean;
  title: string;
}

interface StreamCallbacks {
  onAction?: (action: string) => void;
  onMessage: (chunk: string) => void;
  onTitle: (title: string) => void;
  onSources?: (sources: Source[]) => void;
  onMetrics?: (metrics: MessageMetrics) => void;
  onArtifact?: (artifact: ArtifactData) => void;
  onArtifactStart?: (data: { title: string; template: string }) => void;
  onArtifactFile?: (data: { path: string; code: string }) => void;
  onArtifactEnd?: (data: { files: Record<string, string>; dependencies: Record<string, string> }) => void;
  onWorkflow?: (steps: Array<{ name: string; status: string; parallel?: boolean }>) => void;
  onWorkflowStep?: (step: { name: string; status: string }) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

interface ActiveStreamInternal extends ActiveStream {
  _setCallbacks: (cb: StreamCallbacks) => void;
}

// Global map of chatId → active stream
const streams = new Map<string, ActiveStreamInternal>();

// Track which chat the user is currently viewing (set by the chat page)
let currentViewingChatId: string | null = null;
export function setViewingChat(chatId: string | null) {
  currentViewingChatId = chatId;
}
export function getViewingChat(): string | null {
  return currentViewingChatId;
}

/**
 * Start a new SSE stream for a chat. If one is already active, abort it first.
 * The stream runs globally — survives React component unmounts.
 */
export function startStream(
  chatId: string,
  content: string,
  mode: ChatMode,
  fileIds: string[],
  chatTitle: string,
  callbacks: StreamCallbacks,
  artifactContext?: { files: Record<string, string>; template: string; title: string } | null
): void {
  // Abort existing stream for this chat
  const existing = streams.get(chatId);
  if (existing && !existing.done) {
    existing.abort();
  }

  const stream: ActiveStreamInternal = {
    chatId,
    abort: () => {},
    fullText: "",
    done: false,
    title: chatTitle,
    _setCallbacks: () => {},
  };

  // Store a reference to the CURRENT callbacks — these may go stale on unmount
  let currentCallbacks = callbacks;

  console.log(`[ACTIVE-STREAM] Starting stream for chat ${chatId}`);

  const abort = sendMessage(
    chatId,
    content,
    {
      onAction: (action) => currentCallbacks.onAction?.(action),
      onMessage: (chunk) => {
        stream.fullText += chunk;
        if (stream.fullText.length < 50) console.log(`[ACTIVE-STREAM] First chunks: ${stream.fullText.length} chars`);
        currentCallbacks.onMessage(chunk);
      },
      onTitle: (title) => {
        stream.title = title;
        currentCallbacks.onTitle(title);
      },
      onSources: (sources) => currentCallbacks.onSources?.(sources),
      onMetrics: (metrics) => currentCallbacks.onMetrics?.(metrics),
      onArtifact: (artifact) => currentCallbacks.onArtifact?.(artifact),
      onArtifactStart: (data) => currentCallbacks.onArtifactStart?.(data),
      onArtifactFile: (data) => currentCallbacks.onArtifactFile?.(data),
      onArtifactEnd: (data) => currentCallbacks.onArtifactEnd?.(data),
      onWorkflow: (steps) => currentCallbacks.onWorkflow?.(steps),
      onWorkflowStep: (step) => currentCallbacks.onWorkflowStep?.(step),
      onDone: () => {
        console.log(`[ACTIVE-STREAM] Done! ${stream.fullText.length} chars for chat ${chatId}`);
        stream.done = true;
        currentCallbacks.onDone();
        // Only show toast if user is definitely on a different chat
        // (null means no chat page has registered yet, e.g. during page load)
        if (currentViewingChatId !== null && currentViewingChatId !== chatId) {
          toast.success(`Response ready: ${stream.title || "New Chat"}`, {
            action: {
              label: "View",
              onClick: () => {
                window.dispatchEvent(new CustomEvent("notification-navigate", { detail: { chatId } }));
              },
            },
          });
        }
        // Notify sidebar to refresh
        window.dispatchEvent(new Event("chat-title-updated"));
        // Clean up after a delay
        setTimeout(() => streams.delete(chatId), 5000);
      },
      onError: (err) => {
        console.log(`[ACTIVE-STREAM] Error: ${err} for chat ${chatId}`);
        stream.done = true;
        currentCallbacks.onError(err);
        streams.delete(chatId);
      },
    },
    mode,
    fileIds,
    artifactContext
  );

  stream.abort = abort;
  streams.set(chatId, stream);

  // Expose a way to update callbacks (when component re-mounts on the same chat)
  stream._setCallbacks = (cb: StreamCallbacks) => {
    currentCallbacks = cb;
  };
}

/**
 * Check if a chat has an active (in-progress) stream.
 */
export function isStreamGenerating(chatId: string): boolean {
  const s = streams.get(chatId);
  return s !== undefined && !s.done;
}

export function hasActiveStream(chatId: string): boolean {
  const s = streams.get(chatId);
  return s !== undefined && !s.done;
}

/**
 * Get the active stream for a chat (to re-attach callbacks after navigation back).
 */
export function getActiveStream(chatId: string): ActiveStream | undefined {
  return streams.get(chatId);
}

/**
 * Re-attach callbacks to an active stream (when user navigates back to a chat).
 * Returns the accumulated text so far, or null if no active stream.
 */
export function reattachStream(
  chatId: string,
  callbacks: StreamCallbacks
): string | null {
  const stream = streams.get(chatId);
  if (!stream || stream.done) return null;

  // Update callbacks to point to the new component's state
  stream._setCallbacks(callbacks);
  return stream.fullText;
}

/**
 * Abort a stream for a chat.
 */
export function abortStream(chatId: string): void {
  const s = streams.get(chatId);
  if (s) {
    s.abort();
    streams.delete(chatId);
  }
}
