"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Plus, FileText, Zap, Anchor, Plug, Loader2, LogOut, Settings, ChevronUp, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth-guard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChatList } from "@/components/chat-list";
import { SettingsDialog } from "@/components/settings-dialog";
import { Skeleton } from "boneyard-js/react";
import {
  createChat,
  deleteChat,
  listChats,
  updateChat,
  type ChatSummary,
} from "@/lib/api";

// ── Nav items ──

const NAV_ITEMS = [
  { href: "/documents", icon: FileText, label: "Documents", iconBg: "bg-primary/10", iconBgActive: "bg-primary/25", iconColor: "text-primary", activeBorder: "border-primary/30", activeBg: "bg-primary/5" },
  { href: "/skills", icon: Zap, label: "Skills", iconBg: "bg-amber-500/10", iconBgActive: "bg-amber-500/25", iconColor: "text-amber-500", activeBorder: "border-amber-500/30", activeBg: "bg-amber-500/5" },
  { href: "/hooks", icon: Anchor, label: "Hooks", iconBg: "bg-blue-500/10", iconBgActive: "bg-blue-500/25", iconColor: "text-blue-500", activeBorder: "border-blue-500/30", activeBg: "bg-blue-500/5" },
  { href: "/mcp", icon: Plug, label: "MCP", iconBg: "bg-purple-500/10", iconBgActive: "bg-purple-500/25", iconColor: "text-purple-500", activeBorder: "border-purple-500/30", activeBg: "bg-purple-500/5" },
];

// ── Theme Toggle ──

export function ThemeToggle({ vertical = false }: { vertical?: boolean }) {
  const { theme, setTheme } = useTheme();
  const themes = [
    { value: "light", icon: Sun, title: "Light" },
    { value: "dark", icon: Moon, title: "Dark" },
    { value: "system", icon: Monitor, title: "System" },
  ];

  return (
    <div className={cn(
      "flex items-center justify-center gap-1 border-t px-3 py-2",
      vertical && "flex-col px-0"
    )}>
      {themes.map((t) => {
        const isActive = theme === t.value;
        return (
          <button
            key={t.value}
            onClick={() => setTheme(t.value)}
            title={t.title}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent"
            )}
          >
            <t.icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

// ── User Menu ──

export function UserMenu({ collapsed: menuCollapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const { user, loading, isAuthenticated, requireAuth, logout: handleLogout } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (loading) {
    return (
      <div className={cn("border-t", menuCollapsed ? "flex justify-center py-2" : "p-3")}>
        <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={cn("border-t", menuCollapsed ? "flex justify-center py-2" : "p-3")}>
        {menuCollapsed ? (
          <button
            onClick={() => requireAuth()}
            title="Sign in"
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary"
          >
            ?
          </button>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => requireAuth()}
          >
            Sign in
          </Button>
        )}
      </div>
    );
  }

  const initial = (user?.name?.[0] || user?.email?.[0] || "?").toUpperCase();

  return (
    <div className={cn("border-t", menuCollapsed && "flex justify-center py-2")}>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(
          "flex cursor-pointer items-center border-0 bg-transparent transition-colors hover:bg-accent",
          menuCollapsed
            ? "h-8 w-8 justify-center rounded-full"
            : "w-full gap-2.5 p-3 text-left"
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {initial}
          </div>
          {!menuCollapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
              </div>
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              handleLogout();
              router.push("/");
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onChatsDeleted={() => {
          setSettingsOpen(false);
          window.dispatchEvent(new Event("chats-cleared"));
        }}
      />
    </div>
  );
}

// ── Sidebar Content (shared between Sidebar and Drawer) ──

interface SidebarContentProps {
  showCollapseToggle?: boolean;
  onToggle?: () => void;
  chatListOnly?: boolean;
}

export function SidebarContent({ showCollapseToggle, onToggle, chatListOnly }: SidebarContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { requireAuth, isAuthenticated } = useAuth();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const activeChatId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : null;

  const fetchChats = useCallback(async () => {
    if (!isAuthenticated) {
      setChats([]);
      setIsLoading(false);
      return;
    }
    try {
      const data = await listChats();
      setChats(data.chats);
      cursorRef.current = data.next_cursor;
      hasMoreRef.current = data.has_more;
    } catch (e) {
      console.error("Failed to fetch chats:", e);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const data = await listChats(cursorRef.current);
      setChats((prev) => [...prev, ...data.chats]);
      cursorRef.current = data.next_cursor;
      hasMoreRef.current = data.has_more;
    } catch (e) {
      console.error("Failed to load more chats:", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats, pathname]);

  useEffect(() => {
    const handleRefresh = () => fetchChats();
    const handleClear = () => { setChats([]); cursorRef.current = null; hasMoreRef.current = true; };
    window.addEventListener("chat-title-updated", handleRefresh);
    window.addEventListener("chats-cleared", handleClear);
    return () => {
      window.removeEventListener("chat-title-updated", handleRefresh);
      window.removeEventListener("chats-cleared", handleClear);
    };
  }, [fetchChats]);

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

  // Chat list only mode (used by collapsed sidebar when expanding chat list section)
  if (chatListOnly) {
    return (
      <>
        <div className="px-5 pb-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Recent
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <Skeleton
            name="chat-list"
            loading={isLoading}
            animate="pulse"
            fixture={
              <div className="flex flex-col gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="rounded-lg px-3 py-2">
                    <div className="h-4 w-3/4 rounded bg-muted" />
                    <div className="mt-1.5 h-3 w-1/3 rounded bg-muted" />
                  </div>
                ))}
              </div>
            }
          >
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
          </Skeleton>
        </div>
      </>
    );
  }

  // Full sidebar content
  return (
    <>
      <div className="p-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <img src="/small-logo.png" alt="FN" className="h-7 w-7 rounded-lg" />
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">
                Friendly Neighbor
              </h1>
              <p className="text-xs text-muted-foreground">
                Your AI assistant
              </p>
            </div>
          </div>
          {showCollapseToggle && onToggle && (
            <button onClick={onToggle} title="Collapse sidebar" className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {NAV_ITEMS.map(({ href, icon: Icon, label, iconBg, iconBgActive, iconColor, activeBorder, activeBg }) => {
            const isActive = pathname.startsWith(href);
            return (
              <button
                key={href}
                onClick={() => router.push(href)}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all hover:shadow-md",
                  isActive
                    ? `${activeBorder} ${activeBg} shadow-md`
                    : "border-border/60 bg-card shadow-sm hover:border-primary/30 hover:bg-accent"
                )}
              >
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  isActive ? iconBgActive : iconBg
                )}>
                  <Icon className={cn("h-4 w-4", iconColor)} />
                </div>
                <span className={cn(
                  "text-sm font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                )}>
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

      <div className="px-5 pb-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Recent
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <Skeleton
          name="chat-list"
          loading={isLoading}
          animate="pulse"
          fixture={
            <div className="flex flex-col gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-lg px-3 py-2">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="mt-1.5 h-3 w-1/3 rounded bg-muted" />
                </div>
              ))}
            </div>
          }
        >
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
        </Skeleton>
      </div>
      <ThemeToggle />
      <UserMenu />
    </>
  );
}
