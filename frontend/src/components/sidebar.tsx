"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Plus, FileText, Zap, Anchor, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatList } from "@/components/chat-list";
import { Skeleton } from "boneyard-js/react";
import {
  createChat,
  deleteChat,
  listChats,
  type ChatSummary,
} from "@/lib/api";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const activeChatId = pathname.startsWith("/chat/")
    ? parseInt(pathname.split("/")[2], 10)
    : null;

  const fetchChats = useCallback(async () => {
    try {
      const data = await listChats();
      setChats(data);
    } catch (e) {
      console.error("Failed to fetch chats:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats, pathname]);

  const handleNewChat = async () => {
    try {
      const chat = await createChat();
      await fetchChats();
      router.push(`/chat/${chat.id}`);
    } catch (e) {
      console.error("Failed to create chat:", e);
    }
  };

  const handleDelete = async (chatId: number) => {
    try {
      await deleteChat(chatId);
      await fetchChats();
      if (activeChatId === chatId) {
        router.push("/");
      }
    } catch (e) {
      console.error("Failed to delete chat:", e);
    }
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-muted/30">
      <div className="p-3">
        <h1 className="px-2 text-lg font-bold tracking-tight">
          Friendly Neighbor
        </h1>
        <p className="mb-3 px-2 text-xs text-muted-foreground">
          Your AI assistant
        </p>

        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => router.push("/documents")}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm transition-all hover:border-primary/30 hover:bg-accent hover:shadow-md"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/20">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Documents
            </span>
          </button>
          <button
            onClick={() => router.push("/skills")}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm transition-all hover:border-primary/30 hover:bg-accent hover:shadow-md"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 transition-colors group-hover:bg-amber-500/20">
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Skills
            </span>
          </button>
          <button
            onClick={() => router.push("/hooks")}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm transition-all hover:border-primary/30 hover:bg-accent hover:shadow-md"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 transition-colors group-hover:bg-blue-500/20">
              <Anchor className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Hooks
            </span>
          </button>
          <button
            onClick={() => router.push("/mcp")}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm transition-all hover:border-primary/30 hover:bg-accent hover:shadow-md"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 transition-colors group-hover:bg-purple-500/20">
              <Plug className="h-4 w-4 text-purple-500" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              MCP
            </span>
          </button>
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

      <ScrollArea className="flex-1 px-3 pb-3">
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
          />
        </Skeleton>
      </ScrollArea>
    </aside>
  );
}
