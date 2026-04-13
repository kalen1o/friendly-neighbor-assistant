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

interface FolderDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  onDelete: (action: "move_up" | "delete_all") => Promise<void>;
}

export function FolderDeleteDialog({
  open,
  onOpenChange,
  folderName,
  onDelete,
}: FolderDeleteDialogProps) {
  const [loading, setLoading] = useState(false);

  const handle = async (action: "move_up" | "delete_all") => {
    setLoading(true);
    try {
      await onDelete(action);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{folderName}&rdquo;?</DialogTitle>
          <DialogDescription>
            Choose what happens to the conversations and sub-folders inside.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="outline"
            className="w-full"
            disabled={loading}
            onClick={() => handle("move_up")}
          >
            Move contents to parent folder
          </Button>
          <Button
            variant="destructive"
            className="w-full"
            disabled={loading}
            onClick={() => handle("delete_all")}
          >
            Delete folder and all conversations
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
