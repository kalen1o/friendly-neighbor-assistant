"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { Share2, Search, Download } from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { ChatMessages, EmptyState } from "@/components/chat-messages";
import { ChatInput, type ChatInputHandle, type PendingFile } from "@/components/chat-input";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "@/components/share-dialog";
import { ExportDialog } from "@/components/export-dialog";
import { updateChat, type ChatMode } from "@/lib/api";
import { ArtifactPanel } from "@/components/artifact-panel";
import { ArtifactCard } from "@/components/artifact-card";
import { useAuth } from "@/components/auth-guard";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessageStream } from "@/hooks/use-message-stream";

const subscribe = () => () => {};
const getModKey = () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl");
const getServerModKey = () => "Ctrl";

function KbdShortcut() {
  const mod = useSyncExternalStore(subscribe, getModKey, getServerModKey);
  return <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{mod} + K</kbd>;
}

function MobileHeaderActions({ show, children }: { show: boolean; children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.getElementById("mobile-header-actions"));
  }, []);
  if (!show || !target) return null;
  return createPortal(children, target);
}

export default function ChatPage() {
  const params = useParams();
  const { requireAuth } = useAuth();
  const chatId = params.id as string;

  const {
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
    activeArtifact,
    setActiveArtifact,
    artifactWarnings,
    chatModelId,
    setChatModelId,
    loadOlderMessages,
    doSend,
    fixArtifactError,
  } = useMessageStream(chatId);

  // Notify layout to collapse/expand sidebar when artifact panel opens/closes
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("artifact-panel", { detail: { open: !!activeArtifact } }),
    );
  }, [activeArtifact]);

  const chatInputRef = useRef<ChatInputHandle>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSend = async (content: string, mode: ChatMode = "balanced", files: PendingFile[] = []) => {
    const authed = await requireAuth();
    if (!authed) {
      chatInputRef.current?.setInput(content);
      return;
    }
    doSend(content, mode, files);
  };

  const isEmpty = messages.length === 0 && !chatLoading && !streamingContent && !isLoading && !actionText;
  const [showSuggestions, setShowSuggestions] = useState(!chatLoading);

  // Keep suggestions visible briefly during the slide-down transition
  useEffect(() => {
    if (!isEmpty) {
      const timer = setTimeout(() => setShowSuggestions(false), 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowSuggestions(true);
  }, [isEmpty]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`relative flex-col min-h-0 overflow-hidden transition-[width] duration-300 ease-out ${activeArtifact ? "hidden md:flex md:w-1/2" : "flex w-full"}`}>

        {/* Desktop action buttons — non-overlapping header row */}
        {!isEmpty && (
          <div className="hidden items-center justify-end gap-1 px-4 py-2 md:flex">
            <Button variant="ghost" className="h-8 gap-1.5 px-2.5 text-muted-foreground" onClick={() => setCmdOpen(true)}>
              <Search className="h-3.5 w-3.5" />
              <KbdShortcut />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShareOpen(true)} title="Share">
              <Share2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExportOpen(true)} title="Export">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Mobile action buttons — portaled into the mobile header */}
        <MobileHeaderActions show={!isEmpty}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCmdOpen(true)} title="Search">
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShareOpen(true)} title="Share">
            <Share2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExportOpen(true)} title="Export">
            <Download className="h-4 w-4" />
          </Button>
        </MobileHeaderActions>

        {chatLoading ? (
          <div className="min-h-0 flex-1 px-2 py-4 md:p-4">
            <div className="mx-auto max-w-3xl space-y-3">
              {/* User message skeleton */}
              <div className="flex w-full justify-end">
                <div className="max-w-[80%] rounded-[20px] rounded-br-md bg-primary/80 px-4 py-3 shadow-sm shadow-primary/20">
                  <div className="space-y-2">
                    <Skeleton className="h-3.5 w-48 rounded bg-primary-foreground/20" />
                    <Skeleton className="h-3.5 w-32 rounded bg-primary-foreground/20" />
                  </div>
                </div>
              </div>
              {/* Assistant message skeleton */}
              <div className="flex w-full justify-start">
                <div className="w-[min(80%,500px)] rounded-[20px] rounded-bl-md border border-border/60 bg-card px-4 py-3 shadow-sm">
                  <div className="space-y-2.5">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-[90%]" />
                    <Skeleton className="h-3.5 w-[95%]" />
                    <Skeleton className="h-3.5 w-[70%]" />
                  </div>
                </div>
              </div>
              {/* User message skeleton */}
              <div className="flex w-full justify-end">
                <div className="max-w-[80%] rounded-[20px] rounded-br-md bg-primary/80 px-4 py-3 shadow-sm shadow-primary/20">
                  <Skeleton className="h-3.5 w-36 rounded bg-primary-foreground/20" />
                </div>
              </div>
              {/* Assistant message skeleton */}
              <div className="flex w-full justify-start">
                <div className="w-[min(80%,520px)] rounded-[20px] rounded-bl-md border border-border/60 bg-card px-4 py-3 shadow-sm">
                  <div className="space-y-2.5">
                    <Skeleton className="h-3.5 w-[95%]" />
                    <Skeleton className="h-3.5 w-[85%]" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-[80%]" />
                    <Skeleton className="h-3.5 w-[55%]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : !isEmpty ? (
          <ChatMessages
            messages={messages}
            streamingContent={streamingContent}
            isLoading={isLoading}
            actionText={actionText}
            activeSkills={activeSkills}
            workflowSteps={workflowSteps}
            onEditMessage={(index, newContent) => {
              setMessages((prev) => prev.slice(0, index));
              handleSend(newContent);
            }}
            hasMore={hasMoreMessages}
            loadingMore={loadingMore}
            onLoadMore={loadOlderMessages}
          />
        ) : null}

        {!isEmpty && artifacts.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-2">
            {artifacts.map(a => (
              <ArtifactCard
                key={a.id}
                artifact={a}
                isActive={activeArtifact?.id === a.id}
                onClick={() => {
                  setActiveArtifact(activeArtifact?.id === a.id ? null : a);
                }}
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
          <ChatInput
            ref={chatInputRef}
            onSend={handleSend}
            disabled={isStreaming}
            transparent={isEmpty}
            chatModelId={chatModelId}
            onModelChange={async (modelId) => {
              setChatModelId(modelId);
              await updateChat(chatId, undefined, undefined, modelId);
            }}
          />
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
        <ExportDialog
          chatId={chatId}
          open={exportOpen}
          onOpenChange={setExportOpen}
        />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>

      <div
        className={`h-full overflow-hidden transition-[width,opacity] duration-300 ease-out ${
          activeArtifact ? "w-full md:w-1/2 opacity-100" : "w-0 opacity-0"
        }`}
      >
        {activeArtifact && (
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setActiveArtifact(null)}
            onFixError={(error) => fixArtifactError(error)}
            warnings={artifactWarnings[activeArtifact.id]}
          />
        )}
      </div>
    </div>
  );
}
