"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Eye, Code, Copy, Check, RotateCw, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { ArtifactPreview } from "@/components/artifact-preview";
import { updateArtifact, type ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const CodeEditor = dynamic(
  () => import("@/components/code-editor").then((m) => m.CodeEditor),
  { ssr: false }
);

interface ArtifactPanelProps {
  artifact: ArtifactData;
  onClose: () => void;
  onCodeChange?: (artifactId: string, code: string) => void;
}

export function ArtifactPanel({
  artifact,
  onClose,
  onCodeChange,
}: ArtifactPanelProps) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [localCode, setLocalCode] = useState(artifact.code);
  const [copied, setCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalCode(artifact.code);
  }, [artifact.id, artifact.code]);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setLocalCode(newCode);
      onCodeChange?.(artifact.id, newCode);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifact.id, { code: newCode }).catch(() => toast.error("Failed to save artifact"));
      }, 1000);
    },
    [artifact.id, onCodeChange]
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(localCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReload = () => {
    setIframeLoading(true);
    setPreviewKey((k) => k + 1);
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header — single row: title + badge + toggle + actions */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {/* Title + badge */}
        <span className="truncate text-sm font-medium max-w-[160px]">
          {artifact.title}
        </span>
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5">
          {artifact.type}
        </Badge>

        {/* Separator dot */}
        <span className="text-muted-foreground text-xs">·</span>

        {/* Preview / Code toggle — pill style */}
        <div className="flex items-center rounded-md bg-muted p-0.5">
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
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        {tab === "preview" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleReload}
            title="Reload preview"
          >
            {iframeLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
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
      <div className="relative flex-1 overflow-hidden">
        {tab === "preview" ? (
          <>
            {iframeLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <ArtifactPreview
              key={previewKey}
              code={localCode}
              type={artifact.type}
              onLoad={() => setIframeLoading(false)}
            />
          </>
        ) : (
          <CodeEditor
            value={localCode}
            onChange={handleCodeChange}
            language={artifact.type === "react" ? "jsx" : "html"}
          />
        )}
      </div>
    </div>
  );
}
