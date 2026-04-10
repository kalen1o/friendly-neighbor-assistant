"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  MessageSquare,
  FileText,
  Zap,
  Anchor,
  Plug,
  Plus,
  ArrowRight,
} from "lucide-react";
import { searchChats, createChat, type SearchResult } from "@/lib/api";
import { cn } from "@/lib/utils";

interface QuickAction {
  id: string;
  label: string;
  icon: typeof Plus;
  href: string | null;
  action?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "new-chat", label: "New Chat", icon: Plus, href: null, action: "create-chat" },
  { id: "documents", label: "Documents", icon: FileText, href: "/documents" },
  { id: "skills", label: "Skills", icon: Zap, href: "/skills" },
  { id: "hooks", label: "Hooks", icon: Anchor, href: "/hooks" },
  { id: "mcp", label: "MCP Servers", icon: Plug, href: "/mcp" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filtered quick actions
  const filteredActions = query
    ? QUICK_ACTIONS.filter((a) =>
        a.label.toLowerCase().includes(query.toLowerCase())
      )
    : QUICK_ACTIONS;

  // Total selectable items
  const totalItems = filteredActions.length + results.length;

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      // Small delay to let animation start before focusing
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Search on query change (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setActiveIndex(0);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchChats(query);
        setResults(data.results.slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Clamp active index
  useEffect(() => {
    if (activeIndex >= totalItems) setActiveIndex(Math.max(0, totalItems - 1));
  }, [totalItems, activeIndex]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const executeAction = useCallback(
    async (index: number) => {
      // Quick action
      if (index < filteredActions.length) {
        const action = filteredActions[index];
        if (action.action === "create-chat") {
          close();
          const chat = await createChat();
          router.push(`/chat/${chat.id}`);
        } else if (action.href) {
          close();
          router.push(action.href);
        }
        return;
      }
      // Search result
      const resultIndex = index - filteredActions.length;
      const result = results[resultIndex];
      if (result) {
        close();
        router.push(`/chat/${result.chat_id}`);
      }
    },
    [filteredActions, results, close, router]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % Math.max(totalItems, 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1));
          break;
        case "Enter":
          e.preventDefault();
          executeAction(activeIndex);
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
      }
    },
    [totalItems, activeIndex, executeAction, close]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in duration-150"
        onClick={close}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 ease-out"
        onKeyDown={handleKeyDown}
      >
        <div className="overflow-hidden rounded-xl border bg-background shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats, navigate..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <kbd className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[320px] overflow-y-auto p-2">
            {/* Quick actions */}
            {filteredActions.length > 0 && (
              <div className="mb-1">
                <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Quick Actions
                </p>
                {filteredActions.map((action, i) => (
                  <button
                    key={action.id}
                    onClick={() => executeAction(i)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      activeIndex === i
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/80 hover:bg-accent/50"
                    )}
                  >
                    <action.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{action.label}</span>
                    <ArrowRight className={cn(
                      "h-3 w-3 text-muted-foreground/40 transition-opacity",
                      activeIndex === i ? "opacity-100" : "opacity-0"
                    )} />
                  </button>
                ))}
              </div>
            )}

            {/* Search results */}
            {searching && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                Searching...
              </p>
            )}

            {!searching && results.length > 0 && (
              <div>
                <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Chats
                </p>
                {results.map((result, i) => {
                  const index = filteredActions.length + i;
                  return (
                    <button
                      key={result.message_id}
                      onClick={() => executeAction(index)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                        activeIndex === index
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground/80 hover:bg-accent/50"
                      )}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {result.chat_title || "Untitled"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {result.content.slice(0, 80)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!searching && query && results.length === 0 && filteredActions.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No results found
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
