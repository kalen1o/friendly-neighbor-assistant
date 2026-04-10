"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createShare,
  listShares,
  revokeShare,
  type ShareOut,
} from "@/lib/api";
import { Check, Copy, Globe, Lock, Trash2, Loader2 } from "lucide-react";

interface ShareDialogProps {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ chatId, open, onOpenChange }: ShareDialogProps) {
  const [shares, setShares] = useState<ShareOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "authenticated">(
    "public"
  );
  const [copied, setCopied] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listShares(chatId);
      setShares(data);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [chatId]);

  useEffect(() => {
    if (open) fetchShares();
  }, [open, fetchShares]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createShare(chatId, visibility);
      await fetchShares();
    } catch {
      // ignore
    }
    setCreating(false);
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeShare(shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch {
      // ignore
    }
  };

  const handleCopy = (shareId: string) => {
    const url = `${window.location.origin}/shared/${shareId}`;
    navigator.clipboard.writeText(url);
    setCopied(shareId);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Share conversation</DialogTitle>
        </DialogHeader>

        {/* Create new share */}
        <div className="space-y-3 border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setVisibility("public")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all ${
                  visibility === "public"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                Public
              </button>
              <button
                type="button"
                onClick={() => setVisibility("authenticated")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all ${
                  visibility === "authenticated"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                Logged-in only
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {visibility === "public"
              ? "Anyone with the link can view this conversation."
              : "Only logged-in users with the link can view this conversation."}
          </p>
          <Button onClick={handleCreate} disabled={creating} className="w-full">
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create share link
          </Button>
        </div>

        {/* Existing shares */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Active links</Label>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : shares.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No active share links
            </p>
          ) : (
            shares.map((share) => (
              <div
                key={share.id}
                className="flex items-center gap-2 rounded-lg border p-2.5"
              >
                {share.visibility === "public" ? (
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-sm font-mono">
                  {share.id}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleCopy(share.id)}
                >
                  {copied === share.id ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleRevoke(share.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
