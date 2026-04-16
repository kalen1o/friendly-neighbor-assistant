"use client";

import { useState, useEffect, useRef, useOptimistic, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  ChevronRight,
  ChevronDown,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
  Plus,

  Loader2,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { FolderOut, ChatSummary } from "@/lib/api";
import {
  createFolder,
  updateFolder,
  deleteFolder,
  updateChat,
} from "@/lib/api";
import { isStreamGenerating } from "@/lib/active-streams";
import { FolderDeleteDialog } from "@/components/folder-delete-dialog";
import { ChatInFolder } from "@/components/chat-in-folder";
import { FolderCustomizePopover } from "@/components/folder-customize-popover";

// ── Tree builder ──

interface FolderNode {
  folder: FolderOut;
  children: FolderNode[];
}

function buildTree(folders: FolderOut[]): FolderNode[] {
  const nodeMap = new Map<string, FolderNode>();
  for (const f of folders) nodeMap.set(f.id, { folder: f, children: [] });

  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = nodeMap.get(f.id)!;
    if (f.parent_id && nodeMap.has(f.parent_id)) {
      nodeMap.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.folder.position - b.folder.position);
    for (const n of nodes) sortChildren(n.children);
  };
  sortChildren(roots);
  return roots;
}

// ── Draggable chat item wrapper ──

function DraggableChatItem({
  chat,
  children,
}: {
  chat: ChatSummary;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chat-${chat.id}`,
    data: { type: "chat", chatId: chat.id, title: chat.title },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(isDragging && "opacity-30")}
      style={{ touchAction: "none" }}
    >
      {children}
    </div>
  );
}

// ── Droppable folder wrapper ──

function DroppableFolder({
  folderId,
  children,
}: {
  folderId: string;
  children: (isOver: boolean) => React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `folder-${folderId}`,
    data: { type: "folder", folderId },
  });

  return <div ref={setNodeRef}>{children(isOver)}</div>;
}

// ── Main FolderTree ──

interface FolderTreeProps {
  folders: FolderOut[];
  chats: ChatSummary[];
  activeChatId: string | null;
  editingFolderId: string | null;
  onEditingComplete: () => void;
  onStartEditing: (folderId: string) => void;
  onRefresh: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
}

export function FolderTree({
  folders,
  chats,
  activeChatId,
  editingFolderId,
  onEditingComplete,
  onStartEditing,
  onRefresh,
  onDeleteChat,
  onRenameChat,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("folder-expanded-state");
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [activeDrag, setActiveDrag] = useState<{
    type: string;
    title: string;
  } | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem("folder-expanded-state", JSON.stringify([...expanded]));
  }, [expanded]);

  const toggleExpanded = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // Sensors: pointer (mouse) + touch with activation distance to avoid accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "chat") {
      setActiveDrag({ type: "chat", title: data.title || "New Chat" });
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overData = event.over?.data.current;
    if (overData?.type === "folder") {
      const folderId = overData.folderId as string;
      if (folderId !== "unfiled" && !expanded.has(folderId)) {
        // Clear any existing timer for a different folder
        if (expandTimerRef.current) {
          clearTimeout(expandTimerRef.current);
        }
        expandTimerRef.current = setTimeout(() => {
          setExpanded((prev) => new Set([...prev, folderId]));
          expandTimerRef.current = null;
        }, 500);
      }
    } else {
      // Hovering over non-folder — cancel pending expand
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type === "chat" && overData?.type === "folder") {
      const chatId = activeData.chatId as string;
      const folderId = overData.folderId as string;
      await updateChat(chatId, undefined, folderId === "unfiled" ? null : folderId);
      onRefresh();
    }
  };

  const tree = buildTree(folders);

  // Group chats by folder
  const chatsByFolder = new Map<string | null, ChatSummary[]>();
  for (const chat of chats) {
    const key = chat.folder_id || null;
    if (!chatsByFolder.has(key)) chatsByFolder.set(key, []);
    chatsByFolder.get(key)!.push(chat);
  }

  const unfiledChats = chatsByFolder.get(null) || [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-0.5">
        {tree.map((node) => (
          <FolderNodeItem
            key={node.folder.id}
            node={node}
            depth={0}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            chatsByFolder={chatsByFolder}
            activeChatId={activeChatId}
            folders={folders}
            editingFolderId={editingFolderId}
            onEditingComplete={onEditingComplete}
            onStartEditing={onStartEditing}
            onRefresh={onRefresh}
            onDeleteChat={onDeleteChat}
            onRenameChat={onRenameChat}
          />
        ))}
        {unfiledChats.length > 0 && (
          <>
            <div className="mt-2 px-3 py-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                Unfiled
              </p>
            </div>
            {unfiledChats.map((chat) => (
              <DraggableChatItem key={chat.id} chat={chat}>
                <ChatInFolder
                  chat={chat}
                  isActive={chat.id === activeChatId}
                  depth={0}
                  folders={folders}
                  onDelete={() => onDeleteChat(chat.id)}
                  onRename={(title) => onRenameChat(chat.id, title)}
                  onMoveToFolder={async (folderId) => {
                    await updateChat(chat.id, undefined, folderId);
                    onRefresh();
                  }}
                />
              </DraggableChatItem>
            ))}
          </>
        )}

        {/* Unfiled drop zone — visible during drag */}
        <DroppableFolder folderId="unfiled">
          {(isOver) => (
            <div
              className={cn(
                "mt-1 rounded-lg border-2 border-dashed transition-colors",
                activeDrag
                  ? isOver
                    ? "border-primary/50 bg-primary/5 min-h-[40px]"
                    : "border-muted-foreground/20 min-h-[40px]"
                  : "border-transparent min-h-0"
              )}
            >
              {activeDrag && (
                <p className="py-2 text-center text-[10px] text-muted-foreground/50">
                  Drop here to unfile
                </p>
              )}
            </div>
          )}
        </DroppableFolder>

        {tree.length === 0 && unfiledChats.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            No folders yet
          </p>
        )}
      </div>

      {/* Drag overlay — shows floating item while dragging */}
      <DragOverlay>
        {activeDrag && (
          <div className="rounded-lg border bg-background px-3 py-1.5 text-sm shadow-lg">
            {activeDrag.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Folder node ──

function FolderNodeItem({
  node,
  depth,
  expanded,
  toggleExpanded,
  chatsByFolder,
  activeChatId,
  folders,
  editingFolderId,
  onEditingComplete,
  onStartEditing,
  onRefresh,
  onDeleteChat,
  onRenameChat,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  toggleExpanded: (id: string) => void;
  chatsByFolder: Map<string | null, ChatSummary[]>;
  activeChatId: string | null;
  folders: FolderOut[];
  editingFolderId: string | null;
  onEditingComplete: () => void;
  onStartEditing: (folderId: string) => void;
  onRefresh: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
}) {
  const { folder, children } = node;
  const isExpanded = expanded.has(folder.id);
  const folderChats = chatsByFolder.get(folder.id) || [];
  const notifChats = folderChats.filter((c) => c.has_notification);
  const notificationCount = notifChats.length;
  const hasGenerating = notifChats.some((c) => c.is_generating || isStreamGenerating(c.id));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [, startTransition] = useTransition();
  const [optimisticName, setOptimisticName] = useOptimistic(
    folder.name,
    (_current: string, newName: string) => newName
  );

  // Auto-enter rename mode for newly created folder
  useEffect(() => {
    if (editingFolderId === folder.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRenameValue("");
       
      setRenaming(true);
    }
  }, [editingFolderId, folder.id]);

  const handleRename = () => {
    const trimmed = renameValue.trim();
    if (editingFolderId === folder.id) onEditingComplete();
    setRenaming(false);
    if (trimmed && trimmed !== folder.name) {
      startTransition(async () => {
        setOptimisticName(trimmed);
        await updateFolder(folder.id, { name: trimmed });
        onRefresh();
      });
    }
  };

  const handleCreateSubFolder = async () => {
    try {
      const sub = await createFolder({
        name: "New Folder",
        parent_id: folder.id,
      });
      if (!isExpanded) toggleExpanded(folder.id);
      onRefresh();
      setTimeout(() => onStartEditing(sub.id), 100);
    } catch (e) {
      toast.error((e as Error).message || "Failed to create folder");
    }
  };

  const handleDelete = async (action: "move_up" | "delete_all") => {
    await deleteFolder(folder.id, action);
    onRefresh();
  };

  const Icon = isExpanded ? FolderOpen : FolderIcon;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <>
      <DroppableFolder folderId={folder.id}>
        {(isOver) => (
          <div
            className={cn(
              "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent cursor-pointer",
              isOver && "ring-2 ring-primary/50 bg-primary/5"
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => toggleExpanded(folder.id)}
          >
            <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <div className="flex h-5 w-5 shrink-0 items-center justify-center">
              {folder.icon ? (
                <span className="text-sm">{folder.icon}</span>
              ) : (
                <Icon
                  className="h-4 w-4"
                  style={folder.color ? { color: folder.color } : undefined}
                />
              )}
            </div>
            {renaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={handleRename}
                onClick={(e) => e.stopPropagation()}
                className="h-5 flex-1 truncate border-0 bg-transparent p-0 text-sm outline-none ring-0 focus:ring-0"
              />
            ) : (
              <span className="flex-1 truncate font-medium">
                {optimisticName}
              </span>
            )}
            {!isExpanded && notificationCount > 0 && (
              hasGenerating
                ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            {folder.chat_count > 0 && !isExpanded && (
              <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px] leading-none">
                {folder.chat_count}
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="right"
                className="min-w-[160px]"
              >
                {depth < 1 && (
                  <DropdownMenuItem onClick={() => handleCreateSubFolder()}>
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    New sub-folder
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setRenameValue(folder.name);
                    setRenaming(true);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCustomizeOpen(true)}>
                  Customize
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </DroppableFolder>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{
          gridTemplateRows: isExpanded ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative">
            <div
              className="absolute top-0 bottom-0 w-px bg-border/50"
              style={{ left: `${depth * 16 + 16}px` }}
            />
            {children.map((child) => (
              <FolderNodeItem
                key={child.folder.id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                chatsByFolder={chatsByFolder}
                activeChatId={activeChatId}
                folders={folders}
                editingFolderId={editingFolderId}
                onEditingComplete={onEditingComplete}
                onStartEditing={onStartEditing}
                onRefresh={onRefresh}
                onDeleteChat={onDeleteChat}
                onRenameChat={onRenameChat}
              />
            ))}
            {folderChats.map((chat) => (
              <DraggableChatItem key={chat.id} chat={chat}>
                <ChatInFolder
                  chat={chat}
                  isActive={chat.id === activeChatId}
                  depth={depth + 1}
                  folders={folders}
                  onDelete={() => onDeleteChat(chat.id)}
                  onRename={(title) => onRenameChat(chat.id, title)}
                  onMoveToFolder={async (folderId) => {
                    await updateChat(chat.id, undefined, folderId);
                    onRefresh();
                  }}
                />
              </DraggableChatItem>
            ))}
            {children.length === 0 && folderChats.length === 0 && (
              <p
                className="py-1 text-xs text-muted-foreground/40"
                style={{ paddingLeft: `${(depth + 1) * 16 + 24}px` }}
              >
                Empty folder
              </p>
            )}
          </div>
        </div>
      </div>

      <FolderDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        folderName={folder.name}
        onDelete={handleDelete}
      />
      <FolderCustomizePopover
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        color={folder.color}
        icon={folder.icon}
        onUpdate={async (color, icon) => {
          await updateFolder(folder.id, { color, icon });
          onRefresh();
        }}
      />
    </>
  );
}
