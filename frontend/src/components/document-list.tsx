"use client";

import { useState } from "react";
import { Trash2, FileText, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { DocumentOut } from "@/lib/api";

interface DocumentListProps {
  documents: DocumentOut[];
  onDelete: (docId: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "ready":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "processing":
      return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
    case "failed":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    default:
      return null;
  }
}

export function DocumentList({ documents, onDelete }: DocumentListProps) {
  const [deleteTarget, setDeleteTarget] = useState<DocumentOut | null>(null);

  if (documents.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No documents uploaded yet
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Name</span>
            <span>Status</span>
            <span>Size</span>
            <span></span>
          </div>
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{doc.filename}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusIcon status={doc.status} />
                <Badge variant={doc.status === "ready" ? "secondary" : doc.status === "failed" ? "destructive" : "outline"} className="text-[10px]">
                  {doc.status}
                </Badge>
                {doc.status === "ready" && (
                  <span className="text-xs text-muted-foreground">
                    ({doc.chunk_count} chunks)
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(doc.file_size)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setDeleteTarget(doc)}
                disabled={doc.status === "processing"}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete document?"
        description={`"${deleteTarget?.filename}" and all its chunks will be permanently deleted.`}
        onConfirm={() => { if (deleteTarget) onDelete(deleteTarget.id); }}
      />
    </>
  );
}
