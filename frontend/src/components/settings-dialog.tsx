"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Trash2, AlertTriangle, MessageSquare, Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteAllChats } from "@/lib/api";
import { toast } from "sonner";

type SettingsSection = "chats";

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

const SECTIONS = [
  { id: "chats" as const, label: "Chats", icon: MessageSquare },
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

export function SettingsDialog({ open, onOpenChange, onChatsDeleted }: SettingsDialogProps) {
  const router = useRouter();
  const [section, setSection] = useState<SettingsSection>("chats");
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
    } catch (e) {
      toast.error("Failed to delete chats");
    } finally {
      setDeleting(false);
    }
  };

  const contentSection = (
    <>
      {section === "chats" && (
        <div>
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
        </div>
      )}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setConfirmDelete(false); }}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh]">
        {/* ── Mobile layout: vertical ── */}
        <div className="flex flex-col sm:hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Settings</p>
            <ThemeIcons />
          </div>
          <div className="flex gap-1 border-b px-4 py-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  section === s.id
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground"
                )}
              >
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            ))}
          </div>
          <div className="overflow-y-auto p-4">
            {contentSection}
          </div>
        </div>

        {/* ── Desktop layout: sidebar + content ── */}
        <div className="hidden sm:flex min-h-[400px]">
          <div className="flex w-48 shrink-0 flex-col border-r bg-muted/30">
            <div className="flex-1 p-3">
              <p className="mb-3 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Settings
              </p>
              <nav className="flex flex-col gap-0.5">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSection(s.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      section === s.id
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    <s.icon className="h-4 w-4" />
                    {s.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="border-t p-3">
              <p className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Theme
              </p>
              <div className="flex items-center gap-1 px-1">
                <ThemeIcons />
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {contentSection}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
