/**
 * Global manager for active SSE streams.
 * Keeps LLM responses running even when the user navigates to another chat.
 * The backend saves progressively, so responses survive navigation.
 */

import { sendMessage, type ChatMode } from "@/lib/api";
import { toast } from "sonner";

interface ActiveStream {
  chatId: string;
  abort: () => void;
  fullText: string;
  done: boolean;
  title: string;
}

// Global map of chatId → active stream
const streams = new Map<string, ActiveStream>();

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
  callbacks: {
    onAction?: (action: string) => void;
    onMessage: (chunk: string) => void;
    onTitle: (title: string) => void;
    onSources?: (sources: any[]) => void;
    onMetrics?: (metrics: any) => void;
    onArtifact?: (artifact: any) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): void {
  // Abort existing stream for this chat
  const existing = streams.get(chatId);
  if (existing && !existing.done) {
    existing.abort();
  }

  const stream: ActiveStream = {
    chatId,
    abort: () => {},
    fullText: "",
    done: false,
    title: chatTitle,
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
      onDone: () => {
        console.log(`[ACTIVE-STREAM] Done! ${stream.fullText.length} chars for chat ${chatId}`);
        stream.done = true;
        currentCallbacks.onDone();
        // Only show toast if user is NOT on this chat
        const isOnThisChat = window.location.pathname === `/chat/${chatId}`;
        if (!isOnThisChat) {
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
    fileIds
  );

  stream.abort = abort;
  streams.set(chatId, stream);

  // Expose a way to update callbacks (when component re-mounts on the same chat)
  (stream as any)._setCallbacks = (cb: typeof callbacks) => {
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
  callbacks: {
    onAction?: (action: string) => void;
    onMessage: (chunk: string) => void;
    onTitle: (title: string) => void;
    onSources?: (sources: any[]) => void;
    onMetrics?: (metrics: any) => void;
    onArtifact?: (artifact: any) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): string | null {
  const stream = streams.get(chatId);
  if (!stream || stream.done) return null;

  // Update callbacks to point to the new component's state
  (stream as any)._setCallbacks(callbacks);
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
