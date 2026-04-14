"use client";

import { Layers, Download } from "lucide-react";
import type { ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function downloadProject(artifact: ArtifactData) {
  const content = Object.entries(artifact.files)
    .map(([path, code]) => `// === ${path} ===\n${code}`)
    .join("\n\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${artifact.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ArtifactCard({
  artifact,
  onClick,
}: {
  artifact: ArtifactData;
  onClick: () => void;
}) {
  const fileCount = Object.keys(artifact.files).length;

  return (
    <div className="mt-2 flex w-full items-center gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50">
      <button
        onClick={onClick}
        className="flex flex-1 items-center gap-3 text-left min-w-0"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Layers className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {artifact.title}
            </span>
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">Click to open</p>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          downloadProject(artifact);
        }}
        title="Download"
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  );
}
