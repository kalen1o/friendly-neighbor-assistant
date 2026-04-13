"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Pencil, Loader2, CheckCircle2 } from "lucide-react";
import { isStreamGenerating } from "@/lib/active-streams";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ChatSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ChatListProps {
  chats: ChatSummary[];
  activeChatId: string | null;
  onDelete: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
}

function isRecentlyUpdated(dateStr: string): boolean {
  const updated = new Date(dateStr).getTime();
  const now = Date.now();
  return now - updated < 30000; // 30 seconds
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

function ChatItem({
  chat,
  isActive,
  onDelete,
  onRename,
}: {
  chat: ChatSummary;
  isActive: boolean;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(chat.title || "");
    setEditing(true);
  };

  const save = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== chat.title) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  return (
    <>
      <div
        onClick={() => !editing && router.push(`/chat/${chat.id}`)}
        className={cn(
          "group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 min-h-[44px] text-sm transition-colors duration-150 hover:bg-accent active:bg-muted",
          isActive && "bg-accent"
        )}
      >
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={save}
              className="m-0 h-[1.25rem] w-full truncate border-0 bg-transparent p-0 text-sm font-medium outline-none ring-0 focus:ring-0"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate font-medium">
                {chat.title || "New Chat"}
              </p>
              {chat.has_notification && (
                isStreamGenerating(chat.id)
                  ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                  : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {formatRelativeTime(chat.updated_at)}
          </p>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={startEditing}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete chat?"
        description={`"${chat.title || "New Chat"}" will be permanently deleted. This cannot be undone.`}
        onConfirm={onDelete}
      />
    </>
  );
}

export function ChatList({ chats, activeChatId, onDelete, onRename }: ChatListProps) {
  return (
    <div className="flex flex-col gap-1">
      {chats.map((chat) => (
        <ChatItem
          key={chat.id}
          chat={chat}
          isActive={chat.id === activeChatId}
          onDelete={() => onDelete(chat.id)}
          onRename={(title) => onRename(chat.id, title)}
        />
      ))}
      {chats.length === 0 && (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          No conversations yet
        </p>
      )}
    </div>
  );
}
