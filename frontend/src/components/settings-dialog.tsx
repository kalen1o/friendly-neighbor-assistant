"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Trash2, AlertTriangle, Sun, Moon, Monitor, MessageSquare, Zap, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteAllChats, getUsage, type UsageStats } from "@/lib/api";
import { toast } from "sonner";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChatsDeleted?: () => void;
}

const THEMES = [
  { value: "light", icon: Sun, title: "Light" },
  { value: "dark", icon: Moon, title: "Dark" },
  { value: "system", icon: Monitor, title: "System" },
];

function ThemeIcons() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-1">
      {THEMES.map((t) => {
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function UsageSection() {
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    getUsage().then(setUsage).catch(() => {});
  }, []);

  if (!usage) return null;

  const stats = [
    { icon: MessageSquare, label: "Messages", value: usage.messages },
    { icon: Zap, label: "Tokens", value: formatTokens(usage.tokens_total) },
    { icon: Wrench, label: "Tool calls", value: usage.tool_calls },
  ];

  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold">Usage</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Your usage this month ({usage.period})
      </p>
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-3 text-center">
            <s.icon className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground" />
            <p className="text-lg font-semibold">{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange, onChatsDeleted }: SettingsDialogProps) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAllChats = async () => {
    setDeleting(true);
    try {
      await deleteAllChats();
      toast.success("All chats deleted");
      setConfirmDelete(false);
      onOpenChange(false);
      onChatsDeleted?.();
      router.push("/");
    } catch {
      toast.error("Failed to delete chats");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setConfirmDelete(false); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <p className="text-sm font-semibold">Settings</p>
          <ThemeIcons />
        </div>

        <div className="p-5">
          <h2 className="text-lg font-semibold">Chats</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Manage your conversation history.
          </p>

          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Delete all chats</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Permanently remove all conversations and messages. This cannot be undone.
                </p>
                {!confirmDelete ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="mt-3"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete all chats
                  </Button>
                ) : (
                  <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      Are you sure?
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This will permanently delete all your conversations. This action cannot be reversed.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleting}
                        onClick={handleDeleteAllChats}
                      >
                        {deleting ? "Deleting..." : "Yes, delete everything"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {open && <UsageSection />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
