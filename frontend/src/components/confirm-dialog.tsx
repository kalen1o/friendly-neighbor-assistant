"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={loading}>
            {loading ? "Deleting..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook for managing confirm dialog state.
 * Usage:
 *   const { confirm, dialogProps } = useConfirm();
 *   <Button onClick={() => confirm(() => deleteItem(id))} />
 *   <ConfirmDialog {...dialogProps} title="Delete?" description="..." />
 */
export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [callback, setCallback] = useState<(() => void | Promise<void>) | null>(null);

  const confirm = (fn: () => void | Promise<void>) => {
    setCallback(() => fn);
    setOpen(true);
  };

  const dialogProps = {
    open,
    onOpenChange: setOpen,
    onConfirm: () => callback?.(),
  };

  return { confirm, dialogProps };
}
