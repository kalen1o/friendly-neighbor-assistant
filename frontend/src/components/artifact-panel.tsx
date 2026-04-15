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
  onFixError?: (error: string) => void;
}

/* ── Sandpack save bridge — watches file changes and auto-saves ── */

function SandpackSaveBridge({ artifactId }: { artifactId: string }) {
  const { sandpack } = useSandpack();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFilesRef = useRef<string>("");

  const filesSnapshot = JSON.stringify(
    Object.fromEntries(
      Object.entries(sandpack.files).map(([p, f]) => [p, f.code]),
    ),
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

/* ── Error overlay with Fix button ── */

function SandpackErrorOverlay({ onFix }: { onFix: (error: string) => void }) {
  const { sandpack } = useSandpack();

  const error =
    sandpack.status === "idle" && sandpack.error
      ? sandpack.error.message
      : null;

  if (!error) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/90 p-6">
      <div className="max-w-md rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="mb-3 text-sm font-medium text-destructive">
          Runtime Error
        </p>
        <pre className="mb-4 max-h-[200px] overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">
          {error}
        </pre>
        <Button size="sm" variant="destructive" onClick={() => onFix(error)}>
          Fix this
        </Button>
      </div>
    </div>
  );
}

/* ── Inner panel content (inside SandpackProvider) ── */

function SandpackContent({
  artifact,
  onClose,
  onFixError,
}: ArtifactPanelProps) {
  const { sandpack } = useSandpack();
  const [tab, setTab] = useState<"code" | "preview">("preview");
  const fileCount = Object.keys(artifact.files).length;
  const [prevFile, setPrevFile] = useState(sandpack.activeFile);

  // Switch to code tab when user clicks a file in the explorer
  if (sandpack.activeFile !== prevFile) {
    setPrevFile(sandpack.activeFile);
    setTab("code");
  }

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
      <div className="relative flex flex-1 overflow-hidden">
        {onFixError && <SandpackErrorOverlay onFix={onFixError} />}
        {/* File explorer */}
        <div className="w-[150px] shrink-0 overflow-y-auto border-r">
          <SandpackFileExplorer />
        </div>
        {/* Editor and Preview — both always mounted, toggle visibility */}
        <div className="relative flex-1 overflow-hidden">
          <div className={tab === "code" ? "h-full" : "hidden"}>
            <SandpackCodeEditor
              showLineNumbers
              showTabs={false}
              style={{ height: "100%" }}
            />
          </div>
          <div className={tab === "preview" ? "h-full" : "hidden"}>
            <SandpackPreview
              showNavigator={false}
              showRefreshButton
              showOpenInCodeSandbox={false}
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Ensure Sandpack entry files exist ── */

const ENTRY_FILES: Record<string, Record<string, string>> = {
  react: {
    "/index.js":
      'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\n\nReactDOM.createRoot(document.getElementById("root")).render(<App />);',
  },
  "react-ts": {
    "/index.tsx":
      'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\n\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
  },
};

function ensureEntryFiles(
  files: Record<string, string>,
  template: string,
): Record<string, string> {
  const entries = ENTRY_FILES[template];
  if (!entries) return files;

  const missing: Record<string, string> = {};
  for (const [path, code] of Object.entries(entries)) {
    if (!(path in files)) {
      missing[path] = code;
    }
  }

  if (Object.keys(missing).length === 0) return files;
  return { ...files, ...missing };
}

/* ── Main export ── */

export function ArtifactPanel(props: ArtifactPanelProps) {
  const TEMPLATES = {
    react: "react",
    "react-ts": "react-ts",
    vanilla: "vanilla",
  } as const;
  const template =
    TEMPLATES[props.artifact.template as keyof typeof TEMPLATES] ?? "react";
  const files = ensureEntryFiles(props.artifact.files, template);

  return (
    <SandpackProvider
      template={template}
      files={files}
      customSetup={{
        dependencies: props.artifact.dependencies ?? {},
      }}
      theme="dark"
      options={{
        activeFile: Object.keys(props.artifact.files)[0] ?? "/App.js",
        bundlerURL: "https://sandpack-bundler.codesandbox.io",
      }}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <SandpackContent {...props} />
    </SandpackProvider>
  );
}
