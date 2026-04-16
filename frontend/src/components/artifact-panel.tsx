"use client";

import { useEffect, useRef, useState } from "react";
import { X, Eye, Code, Copy, Check, Download, ChevronDown, History } from "lucide-react";
import {
  SandpackProvider,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackFileExplorer,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { Button } from "@/components/ui/button";
import { updateArtifact, listArtifactVersions, revertArtifact, type ArtifactData, type ArtifactVersionData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { WebContainerFrame } from "@/components/webcontainer-frame";
import { StandaloneEditor } from "@/components/standalone-editor";
import { StandaloneFileExplorer } from "@/components/standalone-file-explorer";
import { downloadProjectZip } from "@/components/artifact-card";

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

  // Skip saving for streaming placeholders — not a real artifact yet
  const isStreaming = artifactId.startsWith("streaming-");

  const filesSnapshot = JSON.stringify(
    Object.fromEntries(
      Object.entries(sandpack.files).map(([p, f]) => [p, f.code]),
    ),
  );

  useEffect(() => {
    if (isStreaming) return;
    if (prevFilesRef.current && filesSnapshot !== prevFilesRef.current) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifactId, {
          files: JSON.parse(filesSnapshot),
        }).catch(() => toast.error("Failed to save project"));
      }, 1000);
    }
    prevFilesRef.current = filesSnapshot;
  }, [filesSnapshot, artifactId, isStreaming]);

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
        <FileDropdown
          files={Object.keys(artifact.files)}
          activeFile={sandpack.activeFile}
          onSelect={(path) => { sandpack.setActiveFile(path); setTab("code"); }}
        />
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
        <VersionDropdown
          artifactId={artifact.id}
          onRevert={(files) => {
            // Sandpack re-mounts via key change — update parent state
            Object.entries(files).forEach(([path, code]) => {
              sandpack.updateFile(path, code);
            });
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => downloadProjectZip(artifact)}
          title="Download ZIP"
        >
          <Download className="h-3.5 w-3.5" />
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
      <div className="relative flex flex-1 overflow-hidden">
        {onFixError && <SandpackErrorOverlay onFix={onFixError} />}
        {/* File explorer — hidden on narrow screens */}
        <div className="hidden md:block w-[150px] shrink-0 overflow-y-auto border-r">
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

/* ── File dropdown for narrow screens ── */

function FileDropdown({ files, activeFile, onSelect }: { files: string[]; activeFile: string; onSelect: (path: string) => void }) {
  return (
    <div className="relative inline-flex md:hidden">
      <select
        value={activeFile}
        onChange={(e) => onSelect(e.target.value)}
        className="appearance-none rounded-md border bg-muted pl-2 pr-6 py-1 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {files.map((f) => (
          <option key={f} value={f}>{f.replace(/^\//, "")}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/* ── Version dropdown (shadcn) ── */

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function VersionDropdown({ artifactId, onRevert }: { artifactId: string; onRevert: (files: Record<string, string>, title: string) => void }) {
  const [versions, setVersions] = useState<ArtifactVersionData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchVersions = async () => {
    if (artifactId.startsWith("streaming-")) return;
    setLoading(true);
    try {
      setVersions(await listArtifactVersions(artifactId));
    } catch {
      toast.error("Failed to load versions");
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async (versionNumber: number) => {
    try {
      const updated = await revertArtifact(artifactId, versionNumber);
      if (updated.files) {
        onRevert(updated.files, updated.title);
        toast.success(`Reverted to v${versionNumber}`);
      }
    } catch {
      toast.error("Failed to revert");
    }
  };

  if (artifactId.startsWith("streaming-")) return null;

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) fetchVersions(); }}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-7 w-7" title="Version history" />}>
        <History className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Version History</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading...</p>
          ) : versions.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No versions yet</p>
          ) : (
            versions.map((v) => (
              <DropdownMenuItem key={v.version_number} onSelect={() => handleRevert(v.version_number)}>
                <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">
                  v{v.version_number}
                </Badge>
                <span className="truncate flex-1">{v.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(v.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

/* ── WebContainer content (for nextjs/node-server/vite templates) ── */

const WEBCONTAINER_TEMPLATES = new Set(["nextjs", "node-server", "vite"]);

function WebContainerContent({ artifact, onClose }: ArtifactPanelProps) {
  const { resolvedTheme } = useTheme();
  const [tab, setTab] = useState<"code" | "preview">("preview");
  const [activeFile, setActiveFile] = useState(Object.keys(artifact.files)[0] ?? "");
  const [files, setFiles] = useState(artifact.files);
  const fileCount = Object.keys(files).length;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreaming = artifact.id.startsWith("streaming-");

  const handleFileChange = (code: string) => {
    const updated = { ...files, [activeFile]: code };
    setFiles(updated);

    if (!isStreaming) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifact.id, { files: updated }).catch(() =>
          toast.error("Failed to save project"),
        );
      }, 1000);
    }
  };

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const code = files[activeFile];
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-medium max-w-[160px]">
          {artifact.title}
        </span>
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </Badge>
        <FileDropdown
          files={Object.keys(files)}
          activeFile={activeFile}
          onSelect={(path) => { setActiveFile(path); setTab("code"); }}
        />
        <span className="text-muted-foreground text-xs hidden md:inline">·</span>
        <Badge variant="outline" className="hidden md:inline-flex shrink-0 text-[10px] px-1.5">
          {artifact.template}
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
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleCopy}
          title={`Copy ${activeFile}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
        <VersionDropdown
          artifactId={artifact.id}
          onRevert={(newFiles) => setFiles(newFiles)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => downloadProjectZip(artifact)}
          title="Download ZIP"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* File explorer — hidden on narrow screens */}
        <div className="hidden md:block w-[150px] shrink-0 overflow-y-auto border-r">
          <StandaloneFileExplorer
            files={files}
            activeFile={activeFile}
            onSelectFile={(path) => {
              setActiveFile(path);
              setTab("code");
            }}
          />
        </div>
        {/* Editor and Preview */}
        <div className="relative flex-1 overflow-hidden">
          <div className={tab === "code" ? "h-full" : "hidden"}>
            <StandaloneEditor
              code={files[activeFile] ?? ""}
              filePath={activeFile}
              onChange={handleFileChange}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
            />
          </div>
          <div className={tab === "preview" ? "h-full" : "hidden"}>
            <WebContainerFrame
              files={files}
              dependencies={artifact.dependencies ?? {}}
              template={artifact.template}
              artifactId={artifact.id}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main export ── */

export function ArtifactPanel(props: ArtifactPanelProps) {
  const { resolvedTheme } = useTheme();
  const isStreaming = props.artifact.id.startsWith("streaming-");

  if (isStreaming) {
    const fileCount = Object.keys(props.artifact.files).length;
    const totalChars = Object.values(props.artifact.files).reduce((sum, code) => sum + code.length, 0);
    const maxChars = 65_000; // ~16K tokens * ~4 chars/token
    const pct = Math.min((totalChars / maxChars) * 100, 100);
    const barColor = pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-green-500";

    return (
      <div className="flex h-full flex-col items-center justify-center border-l bg-background gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">
          Generating {props.artifact.title}...
        </p>
        {fileCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {fileCount} {fileCount === 1 ? "file" : "files"} received
          </p>
        )}
        {totalChars > 0 && (
          <div className="w-48 flex flex-col items-center gap-1">
            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {(totalChars / 1000).toFixed(1)}K / {(maxChars / 1000).toFixed(0)}K chars
              {pct >= 80 && (
                <span className={pct >= 95 ? " text-red-500 font-medium" : " text-yellow-500"}>
                  {" "}— {pct >= 95 ? "may be truncated" : "approaching limit"}
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    );
  }

  // WebContainer templates
  if (WEBCONTAINER_TEMPLATES.has(props.artifact.template)) {
    return <WebContainerContent {...props} />;
  }

  // Sandpack templates (react, react-ts, vanilla)
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
      key={props.artifact.id}
      template={template}
      files={files}
      customSetup={{
        dependencies: props.artifact.dependencies ?? {},
      }}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
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
