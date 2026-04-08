"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ChatListProps {
  chats: ChatSummary[];
  activeChatId: number | null;
  onDelete: (chatId: number) => void;
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ChatList({ chats, activeChatId, onDelete }: ChatListProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      {chats.map((chat) => (
        <div
          key={chat.id}
          onClick={() => router.push(`/chat/${chat.id}`)}
          className={cn(
            "group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors duration-150 hover:bg-accent",
            chat.id === activeChatId && "bg-accent"
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {chat.title || "New Chat"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(chat.updated_at)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(chat.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {chats.length === 0 && (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          No conversations yet
        </p>
      )}
    </div>
  );
}
