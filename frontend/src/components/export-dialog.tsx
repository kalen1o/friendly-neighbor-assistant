"use client";

import { useState } from "react";
import { FileText, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { exportChat } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ExportDialogProps {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FORMATS = [
  {
    id: "markdown" as const,
    label: "Markdown",
    description: "Plain text, easy to edit",
    ext: ".md",
    icon: FileText,
  },
  {
    id: "pdf" as const,
    label: "PDF",
    description: "Formatted, ready to share",
    ext: ".pdf",
    icon: FileDown,
  },
];

export function ExportDialog({ chatId, open, onOpenChange }: ExportDialogProps) {
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = async (format: "markdown" | "pdf") => {
    setExporting(format);
    try {
      await exportChat(chatId, format);
      onOpenChange(false);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Export Conversation</DialogTitle>
          <DialogDescription>
            Choose a format to download this conversation.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {FORMATS.map((fmt) => {
            const isLoading = exporting === fmt.id;
            const disabled = exporting !== null;
            return (
              <Button
                key={fmt.id}
                variant="outline"
                disabled={disabled}
                onClick={() => handleExport(fmt.id)}
                className={cn(
                  "h-auto justify-start gap-3 px-4 py-3",
                  !disabled && "hover:border-primary/40 hover:bg-accent"
                )}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <fmt.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <div className="text-left">
                  <p className="text-sm font-medium">
                    {fmt.label}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {fmt.ext}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{fmt.description}</p>
                </div>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
