"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const COLORS = [
  { name: "Default", value: "" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Green", value: "#22c55e" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
];

const ICONS = [
  "", "📁", "💼", "🏠", "🎯", "🔬", "📚", "💡", "🛠️", "🎨",
  "🚀", "📝", "🧪", "💬", "🌐", "📊", "🔒", "❤️", "⭐", "🎓",
];

interface FolderCustomizePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  color: string | null;
  icon: string | null;
  onUpdate: (color: string | null, icon: string | null) => Promise<void>;
}

export function FolderCustomizePopover({
  open,
  onOpenChange,
  color,
  icon,
  onUpdate,
}: FolderCustomizePopoverProps) {
  const [selectedColor, setSelectedColor] = useState(color || "");
  const [selectedIcon, setSelectedIcon] = useState(icon || "");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onUpdate(
        selectedColor || null,
        selectedIcon || null
      );
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Customize Folder</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Color</p>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setSelectedColor(c.value)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all",
                    selectedColor === c.value
                      ? "border-foreground scale-110"
                      : "border-transparent hover:border-muted-foreground/30"
                  )}
                  title={c.name}
                >
                  {c.value ? (
                    <div
                      className="h-5 w-5 rounded-full"
                      style={{ backgroundColor: c.value }}
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-dashed border-muted-foreground/30" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Icon</p>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setSelectedIcon(ic)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-all",
                    selectedIcon === ic
                      ? "bg-primary/10 ring-2 ring-primary/50"
                      : "hover:bg-accent"
                  )}
                >
                  {ic || "—"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
