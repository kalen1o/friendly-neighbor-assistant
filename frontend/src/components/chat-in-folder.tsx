"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, FolderInput, MoreHorizontal, Loader2, CheckCircle2 } from "lucide-react";
import { isStreamGenerating } from "@/lib/active-streams";
import { cn } from "@/lib/utils";
import type { ChatSummary, FolderOut } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function isRecentlyUpdated(dateStr: string): boolean {
  const updated = new Date(dateStr).getTime();
  const now = Date.now();
  return now - updated < 30000; // 30 seconds
}

export interface ChatInFolderProps {
  chat: ChatSummary;
  isActive: boolean;
  depth: number;
  folders?: FolderOut[];
  onDelete: () => void;
  onRename: (title: string) => void;
  onMoveToFolder?: (folderId: string | null) => void;
}

export function ChatInFolder({
  chat,
  isActive,
  depth,
  folders = [],
  onDelete,
  onRename,
  onMoveToFolder,
}: ChatInFolderProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const save = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== chat.title) onRename(trimmed);
    setEditing(false);
  };

  // Build folder options for "Move to" menu (exclude current folder)
  const rootFolders = folders.filter((f) => !f.parent_id);
  const subFolders = (parentId: string) =>
    folders.filter((f) => f.parent_id === parentId);

  return (
    <>
      <div
        className={cn(
          "group flex cursor-pointer items-center rounded-lg py-1.5 pr-2 text-sm transition-colors hover:bg-accent",
          isActive && "bg-accent"
        )}
        style={{ paddingLeft: `${depth * 16 + 24}px` }}
        onClick={() => !editing && router.push(`/chat/${chat.id}`)}
      >
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={save}
            onClick={(e) => e.stopPropagation()}
            className="h-5 flex-1 truncate border-0 bg-transparent p-0 text-sm outline-none ring-0 focus:ring-0"
          />
        ) : (
          <>
            <span className="flex-1 truncate">
              {chat.title || "New Chat"}
            </span>
            {chat.has_notification && (
              isStreamGenerating(chat.id)
                ? <Loader2 className="ml-1.5 h-3 w-3 shrink-0 animate-spin text-primary" />
                : <CheckCircle2 className="ml-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
            )}
          </>
        )}
        {!editing && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="min-w-[160px]">
              <DropdownMenuItem
                onClick={() => {
                  setEditValue(chat.title || "");
                  setEditing(true);
                }}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>

              {onMoveToFolder && folders.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderInput className="mr-2 h-3.5 w-3.5" />
                    Move to folder
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-[160px]">
                    {/* Unfiled option */}
                    {chat.folder_id && (
                      <>
                        <DropdownMenuItem onClick={() => onMoveToFolder(null)}>
                          Remove from folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {/* Root folders */}
                    {rootFolders.map((f) => {
                      const subs = subFolders(f.id);
                      if (subs.length > 0) {
                        return (
                          <DropdownMenuSub key={f.id}>
                            <DropdownMenuSubTrigger
                              onClick={() => onMoveToFolder(f.id)}
                            >
                              {f.icon ? (
                                <span className="mr-2 text-xs">{f.icon}</span>
                              ) : (
                                <span
                                  className="mr-2 inline-block h-3 w-3 rounded-sm"
                                  style={{ backgroundColor: f.color || "var(--muted-foreground)" }}
                                />
                              )}
                              {f.name}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-[140px]">
                              <DropdownMenuItem onClick={() => onMoveToFolder(f.id)}>
                                {f.name} (root)
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {subs.map((sub) => (
                                <DropdownMenuItem
                                  key={sub.id}
                                  onClick={() => onMoveToFolder(sub.id)}
                                >
                                  {sub.icon ? (
                                    <span className="mr-2 text-xs">{sub.icon}</span>
                                  ) : (
                                    <span
                                      className="mr-2 inline-block h-3 w-3 rounded-sm"
                                      style={{ backgroundColor: sub.color || "var(--muted-foreground)" }}
                                    />
                                  )}
                                  {sub.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        );
                      }
                      return (
                        <DropdownMenuItem
                          key={f.id}
                          onClick={() => onMoveToFolder(f.id)}
                        >
                          {f.icon ? (
                            <span className="mr-2 text-xs">{f.icon}</span>
                          ) : (
                            <span
                              className="mr-2 inline-block h-3 w-3 rounded-sm"
                              style={{ backgroundColor: f.color || "var(--muted-foreground)" }}
                            />
                          )}
                          {f.name}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete chat?"
        description={`"${chat.title || "New Chat"}" will be permanently deleted.`}
        onConfirm={onDelete}
      />
    </>
  );
}
