"use client";

import { Code, Globe } from "lucide-react";
import type { ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

interface ArtifactCardProps {
  artifact: ArtifactData;
  onClick: () => void;
}

export function ArtifactCard({ artifact, onClick }: ArtifactCardProps) {
  return (
    <button
      onClick={onClick}
      className="mt-2 flex w-full items-center gap-3 rounded-lg border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {artifact.type === "react" ? (
          <Code className="h-5 w-5" />
        ) : (
          <Globe className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{artifact.title}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {artifact.type}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Click to open</p>
      </div>
    </button>
  );
}
