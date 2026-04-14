"use client";

import { useEffect, useRef, useState } from "react";
import { X, Eye, Code, Copy, Check } from "lucide-react";
import {
  SandpackProvider,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackFileExplorer,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { Button } from "@/components/ui/button";
import { updateArtifact, type ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ArtifactPanelProps {
  artifact: ArtifactData;
  onClose: () => void;
}

/* ── Sandpack save bridge — watches file changes and auto-saves ── */

function SandpackSaveBridge({ artifactId }: { artifactId: string }) {
  const { sandpack } = useSandpack();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFilesRef = useRef<string>("");

  const filesSnapshot = JSON.stringify(
    Object.fromEntries(
      Object.entries(sandpack.files).map(([p, f]) => [p, f.code])
    )
  );

  useEffect(() => {
    if (prevFilesRef.current && filesSnapshot !== prevFilesRef.current) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifactId, {
          files: JSON.parse(filesSnapshot),
        }).catch(() => toast.error("Failed to save project"));
      }, 1000);
    }
    prevFilesRef.current = filesSnapshot;
  }, [filesSnapshot, artifactId]);

  return null;
}

/* ── Copy button that copies the active file ── */

function CopyActiveFile() {
  const { sandpack } = useSandpack();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const activeFile = sandpack.files[sandpack.activeFile];
    if (activeFile) {
      navigator.clipboard.writeText(activeFile.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={handleCopy}
      title={`Copy ${sandpack.activeFile}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

/* ── Inner panel content (inside SandpackProvider) ── */

function SandpackContent({
  artifact,
  onClose,
}: ArtifactPanelProps) {
  const [tab, setTab] = useState<"code" | "preview">("code");
  const fileCount = Object.keys(artifact.files).length;

  return (
    <div className="flex h-full flex-col border-l bg-background">
      <SandpackSaveBridge artifactId={artifact.id} />

      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-medium max-w-[160px]">
          {artifact.title}
        </span>
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </Badge>
        <span className="text-muted-foreground text-xs">·</span>
        <div className="flex items-center rounded-md bg-muted p-0.5">
          <button
            onClick={() => setTab("code")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              tab === "code"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code className="h-3 w-3" />
            Code
          </button>
          <button
            onClick={() => setTab("preview")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              tab === "preview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
        <div className="flex-1" />
        <CopyActiveFile />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File explorer */}
        <div className="w-[150px] shrink-0 overflow-y-auto border-r">
          <SandpackFileExplorer />
        </div>
        {/* Editor or Preview */}
        <div className="flex-1 overflow-hidden">
          {tab === "code" ? (
            <SandpackCodeEditor
              showLineNumbers
              showTabs={false}
              style={{ height: "100%" }}
            />
          ) : (
            <SandpackPreview
              showNavigator={false}
              showRefreshButton
              style={{ height: "100%" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main export ── */

export function ArtifactPanel(props: ArtifactPanelProps) {
  const template =
    props.artifact.template === "vanilla" ? "vanilla" : "react";

  return (
    <SandpackProvider
      template={template}
      files={props.artifact.files}
      customSetup={{
        dependencies: props.artifact.dependencies ?? {},
      }}
      theme="dark"
      options={{
        activeFile: Object.keys(props.artifact.files)[0] ?? "/App.js",
      }}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <SandpackContent {...props} />
    </SandpackProvider>
  );
}
