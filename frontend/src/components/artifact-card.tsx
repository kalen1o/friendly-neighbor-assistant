"use client";

import { Layers, Download } from "lucide-react";
import JSZip from "jszip";
import type { ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export async function downloadProjectZip(artifact: ArtifactData) {
  const zip = new JSZip();

  // Add all files at their paths
  for (const [path, code] of Object.entries(artifact.files)) {
    zip.file(path.replace(/^\//, ""), code);
  }

  // Generate package.json from dependencies if not already in files
  if (!artifact.files["/package.json"] && Object.keys(artifact.dependencies ?? {}).length > 0) {
    const pkg = JSON.stringify(
      { name: artifact.title.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase(), private: true, dependencies: artifact.dependencies },
      null,
      2,
    );
    zip.file("package.json", pkg);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${artifact.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ArtifactCard({
  artifact,
  isActive,
  onClick,
}: {
  artifact: ArtifactData;
  isActive?: boolean;
  onClick: () => void;
}) {
  const fileCount = Object.keys(artifact.files).length;

  return (
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className={`mt-2 cursor-pointer flex-row items-center gap-3 p-3 transition-colors ${
        isActive
          ? "ring-2 ring-primary bg-primary/10"
          : "hover:bg-muted/50"
      }`}
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
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          downloadProjectZip(artifact);
        }}
        title="Download"
      >
        <Download className="h-4 w-4" />
      </Button>
    </Card>
  );
}
