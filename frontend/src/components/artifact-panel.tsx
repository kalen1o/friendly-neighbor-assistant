"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Eye, Code, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArtifactPreview } from "@/components/artifact-preview";
import { updateArtifact, type ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalCode(artifact.code);
  }, [artifact.id, artifact.code]);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setLocalCode(newCode);
      onCodeChange?.(artifact.id, newCode);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifact.id, { code: newCode }).catch(() => {});
      }, 1000);
    },
    [artifact.id, onCodeChange]
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(localCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate max-w-[200px]">
            {artifact.title}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {artifact.type}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
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
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b px-3">
        <button
          onClick={() => setTab("preview")}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "preview"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>
        <button
          onClick={() => setTab("code")}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "code"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code className="h-3.5 w-3.5" />
          Code
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "preview" ? (
          <ArtifactPreview code={localCode} type={artifact.type} />
        ) : (
          <textarea
            value={localCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            className="h-full w-full resize-none border-0 bg-muted/30 p-4 font-mono text-sm focus:outline-none"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
