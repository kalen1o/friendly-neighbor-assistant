"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Plus, FileText, Zap, Anchor, Plug, Loader2, FolderPlus } from "lucide-react";
import { useAuth } from "@/components/auth-guard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChatList } from "@/components/chat-list";
import { FolderTree } from "@/components/folder-tree";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createChat,
  deleteChat,
  listChats,
  updateChat,
  listFolders,
  createFolder,
  type ChatSummary,
  type FolderOut,
} from "@/lib/api";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export { ThemeToggle } from "./theme-toggle";
export { UserMenu } from "./user-menu";

// ── Loading skeletons ──

function ChatListSkeleton() {
  const widths = ["w-3/4", "w-1/2", "w-2/3", "w-3/5", "w-4/5"];
  return (
    <div className="flex flex-col gap-1">
      {widths.map((w, i) => (
        <div key={i} className="flex min-h-[44px] flex-col justify-center rounded-lg px-3 py-2">
          <Skeleton className={cn("h-4 rounded", w)} />
          <Skeleton className="mt-1.5 h-3 w-1/4 rounded" />
        </div>
      ))}
    </div>
  );
}

function FolderTreeSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      {/* Folder 1 — expanded with 2 chats */}
      <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-3.5 w-24 rounded" />
      </div>
      <div className="flex items-center gap-1 rounded-lg py-1.5" style={{ paddingLeft: 40 }}>
        <Skeleton className="h-3.5 w-32 rounded" />
      </div>
      <div className="flex items-center gap-1 rounded-lg py-1.5" style={{ paddingLeft: 40 }}>
        <Skeleton className="h-3.5 w-24 rounded" />
      </div>
      {/* Folder 2 — collapsed */}
      <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-3.5 w-20 rounded" />
      </div>
      {/* Folder 3 — collapsed */}
      <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-3.5 w-28 rounded" />
      </div>
    </div>
  );
}

// ── Nav items ──

const NAV_ITEMS = [
  { href: "/documents", icon: FileText, label: "Documents", iconBg: "bg-primary/10", iconBgActive: "bg-primary/25", iconColor: "text-primary", activeBorder: "border-primary/30", activeBg: "bg-primary/5" },
  { href: "/skills", icon: Zap, label: "Skills", iconBg: "bg-amber-500/10", iconBgActive: "bg-amber-500/25", iconColor: "text-amber-500", activeBorder: "border-amber-500/30", activeBg: "bg-amber-500/5" },
  { href: "/hooks", icon: Anchor, label: "Hooks", iconBg: "bg-blue-500/10", iconBgActive: "bg-blue-500/25", iconColor: "text-blue-500", activeBorder: "border-blue-500/30", activeBg: "bg-blue-500/5" },
  { href: "/mcp", icon: Plug, label: "MCP", iconBg: "bg-purple-500/10", iconBgActive: "bg-purple-500/25", iconColor: "text-purple-500", activeBorder: "border-purple-500/30", activeBg: "bg-purple-500/5" },
];

// ── Sidebar Content (shared between Sidebar and Drawer) ──

interface SidebarContentProps {
  showCollapseToggle?: boolean;
  onToggle?: () => void;
  chatListOnly?: boolean;
}

export function SidebarContent({ showCollapseToggle, onToggle, chatListOnly }: SidebarContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { requireAuth, isAuthenticated, loading: authLoading } = useAuth();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const activeChatId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : null;

  const [viewMode, setViewMode] = useState<"all" | "folders">("all");
  const [folders, setFolders] = useState<FolderOut[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);

  // Read persisted view mode after hydration to avoid SSR mismatch
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar-view-mode") as "all" | "folders" | null;
      if (saved) setViewMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebar-view-mode", viewMode);
  }, [viewMode]);

  // Track which chats had notifications last poll (to detect new ones)
  const prevNotifIdsRef = useRef<Set<string>>(new Set());

  const fetchChats = useCallback(async () => {
    if (!isAuthenticated) {
      setChats([]);
      if (!authLoading) setIsLoading(false);
      return;
    }
    try {
      const data = await listChats();
      setChats(data.chats);
      cursorRef.current = data.next_cursor;
      hasMoreRef.current = data.has_more;

      // Detect NEW notifications (not previously seen)
      const newNotifChats = data.chats.filter(
        (c) => c.has_notification && !prevNotifIdsRef.current.has(c.id)
      );
      for (const chat of newNotifChats) {
        if (pathname !== `/chat/${chat.id}`) {
          toast.success(`Response ready: ${chat.title || "New Chat"}`);
        }
      }
      // Update tracked notification IDs
      prevNotifIdsRef.current = new Set(
        data.chats.filter((c) => c.has_notification).map((c) => c.id)
      );
    } catch (e) {
      console.error("Failed to fetch chats:", e);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, authLoading]);

  const fetchFolders = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await listFolders();
      setFolders(data);
    } catch (e) {
      console.error("Failed to fetch folders:", e);
    }
  }, [isAuthenticated]);

  const handleRefreshAll = useCallback(() => {
    fetchChats();
    fetchFolders();
  }, [fetchChats, fetchFolders]);

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const data = await listChats(cursorRef.current);
      setChats((prev) => [...prev, ...data.chats]);
      cursorRef.current = data.next_cursor;
      hasMoreRef.current = data.has_more;
    } catch (e) {
      console.error("Failed to load more chats:", e);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats, pathname]);

  // Handle notification click navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const chatId = (e as CustomEvent).detail?.chatId;
      if (chatId) router.push(`/chat/${chatId}`);
    };
    window.addEventListener("notification-navigate", handler);
    return () => window.removeEventListener("notification-navigate", handler);
  }, [router]);

  // Poll for notification updates every 10 seconds
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(fetchChats, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchChats]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    const handleRefresh = () => fetchChats();
    const handleClear = () => { setChats([]); cursorRef.current = null; hasMoreRef.current = true; };
    window.addEventListener("chat-title-updated", handleRefresh);
    window.addEventListener("chats-cleared", handleClear);
    window.addEventListener("folders-changed", handleRefreshAll);
    return () => {
      window.removeEventListener("chat-title-updated", handleRefresh);
      window.removeEventListener("chats-cleared", handleClear);
      window.removeEventListener("folders-changed", handleRefreshAll);
    };
  }, [fetchChats, handleRefreshAll]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreRef.current) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const handleNewChat = async () => {
    const authed = await requireAuth();
    if (!authed) return;
    try {
      const chat = await createChat();
      await fetchChats();
      router.push(`/chat/${chat.id}`);
    } catch (e) {
      console.error("Failed to create chat:", e);
    }
  };

  const handleDelete = async (chatId: string) => {
    try {
      await deleteChat(chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        router.push("/");
      }
    } catch (e) {
      console.error("Failed to delete chat:", e);
    }
  };

  const handleRename = async (chatId: string, title: string) => {
    try {
      await updateChat(chatId, title);
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, title } : c))
      );
    } catch (e) {
      console.error("Failed to rename chat:", e);
    }
  };

  const handleNewFolder = async () => {
    const authed = await requireAuth();
    if (!authed) return;
    try {
      const folder = await createFolder({ name: "New Folder" });
      await fetchFolders();
      setEditingFolderId(folder.id);
    } catch (e) {
      toast.error((e as Error).message || "Failed to create folder");
    }
  };

  // Chat list only mode (used by desktop sidebar)
  if (chatListOnly) {
    if (!isAuthenticated && !authLoading) return null;
    return (
      <>
        <div className="flex items-center justify-between px-5 pb-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode("all")}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
                viewMode === "all"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              )}
            >
              All
            </button>
            <button
              onClick={() => setViewMode("folders")}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
                viewMode === "folders"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              )}
            >
              Folders
            </button>
          </div>
          {viewMode === "folders" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground/50 hover:text-muted-foreground"
              onClick={handleNewFolder}
              title="New folder"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {isLoading ? (
            viewMode === "folders" ? <FolderTreeSkeleton /> : <ChatListSkeleton />
          ) : viewMode === "all" ? (
            <>
              <ChatList
                chats={chats}
                activeChatId={activeChatId}
                onDelete={handleDelete}
                onRename={handleRename}
              />
              {isLoadingMore && (
                <div className="flex justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <div ref={sentinelRef} className="h-1" />
            </>
          ) : (
            <>
              <FolderTree
                folders={folders}
                chats={chats}
                activeChatId={activeChatId}
                editingFolderId={editingFolderId}
                onEditingComplete={() => setEditingFolderId(null)}
                onStartEditing={setEditingFolderId}
                onRefresh={handleRefreshAll}
                onDeleteChat={handleDelete}
                onRenameChat={handleRename}
              />
            </>
          )}
        </div>
      </>
    );
  }

  // Full sidebar content
  return (
    <>
      <div className="p-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-2">
            <img src="/small-logo.png" alt="FN" className="h-7 w-7 rounded-lg" />
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">
                Friendly Neighbor
              </h1>
              <p className="text-xs text-muted-foreground">
                Your AI assistant
              </p>
            </div>
          </Link>
          {showCollapseToggle && onToggle && (
            <Button variant="ghost" size="icon-sm" onClick={onToggle} title="Collapse sidebar" className="text-muted-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, icon: Icon, label, iconColor }) => {
            const isActive = pathname.startsWith(href);
            return (
              <button
                key={href}
                onClick={() => router.push(href)}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors",
                  isActive
                    ? cn("bg-accent", iconColor)
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate text-[13px] font-medium">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      <div className="p-3">
        <Button
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {isAuthenticated && (
        <>
          <div className="flex items-center justify-between px-5 pb-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode("all")}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
                  viewMode === "all"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                )}
              >
                All
              </button>
              <button
                onClick={() => setViewMode("folders")}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
                  viewMode === "folders"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                )}
              >
                Folders
              </button>
            </div>
            {viewMode === "folders" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground/50 hover:text-muted-foreground"
                onClick={handleNewFolder}
                title="New folder"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {isLoading ? (
              viewMode === "folders" ? <FolderTreeSkeleton /> : <ChatListSkeleton />
            ) : viewMode === "all" ? (
              <>
                <ChatList
                  chats={chats}
                  activeChatId={activeChatId}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
                {isLoadingMore && (
                  <div className="flex justify-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                <div ref={sentinelRef} className="h-1" />
              </>
            ) : (
              <>
                <FolderTree
                  folders={folders}
                  chats={chats}
                  activeChatId={activeChatId}
                  editingFolderId={editingFolderId}
                  onEditingComplete={() => setEditingFolderId(null)}
                  onStartEditing={setEditingFolderId}
                  onRefresh={handleRefreshAll}
                  onDeleteChat={handleDelete}
                  onRenameChat={handleRename}
                />
                <div
                  className="mt-2 min-h-[40px] rounded-lg border-2 border-dashed border-transparent transition-colors"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add("border-muted-foreground/30");
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove("border-muted-foreground/30");
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("border-muted-foreground/30");
                    const chatId = e.dataTransfer.getData("text/chat-id");
                    if (chatId) {
                      await updateChat(chatId, undefined, null);
                      handleRefreshAll();
                    }
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
      {!isAuthenticated && <div className="flex-1" />}
      <ThemeToggle />
      <UserMenu />
    </>
  );
}
