"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, FileMinus2, FileDiff, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  diffArtifactVersions,
  listArtifactVersions,
  type ArtifactDiffData,
  type ArtifactFileDiff,
  type ArtifactVersionData,
} from "@/lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactId: string;
}

/**
 * Parse a unified diff into styled lines. Keeps things dependency-free —
 * no external diff-renderer package. Just splits on newlines and tags
 * each line as context/add/remove/hunk so the JSX can colour them.
 */
function parseUnifiedDiff(diff: string): Array<{ kind: "hunk" | "add" | "remove" | "context" | "meta"; text: string }> {
  const out: Array<{ kind: "hunk" | "add" | "remove" | "context" | "meta"; text: string }> = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      out.push({ kind: "meta", text: line });
    } else if (line.startsWith("@@")) {
      out.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+")) {
      out.push({ kind: "add", text: line });
    } else if (line.startsWith("-")) {
      out.push({ kind: "remove", text: line });
    } else {
      out.push({ kind: "context", text: line });
    }
  }
  // Trim trailing blank from the splitlines artifact.
  if (out.length && out[out.length - 1].text === "") out.pop();
  return out;
}

function FileDiffBlock({ file }: { file: ArtifactFileDiff }) {
  const [expanded, setExpanded] = useState(true);

  const Icon =
    file.status === "added"
      ? FilePlus2
      : file.status === "removed"
      ? FileMinus2
      : FileDiff;
  const iconColor =
    file.status === "added"
      ? "text-emerald-500"
      : file.status === "removed"
      ? "text-rose-500"
      : "text-amber-500";

  const body = useMemo(() => {
    if (file.status === "modified" && file.diff) {
      return parseUnifiedDiff(file.diff);
    }
    if (file.content) {
      const sign = file.status === "added" ? "+" : "-";
      return file.content
        .split("\n")
        .slice(0, file.content.endsWith("\n") ? -1 : undefined)
        .map((line) => ({
          kind: (file.status === "added" ? "add" : "remove") as "add" | "remove",
          text: `${sign}${line}`,
        }));
    }
    return [];
  }, [file]);

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
          <span className="font-mono text-xs truncate">{file.path}</span>
          <span className="ml-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {file.status}
          </span>
        </div>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>
      {expanded && body.length > 0 && (
        <pre className="overflow-x-auto bg-background font-mono text-[11px] leading-relaxed">
          {body.map((line, i) => {
            const bg =
              line.kind === "add"
                ? "bg-emerald-500/10"
                : line.kind === "remove"
                ? "bg-rose-500/10"
                : line.kind === "hunk"
                ? "bg-muted/40 text-muted-foreground"
                : line.kind === "meta"
                ? "text-muted-foreground/70"
                : "";
            return (
              <div key={i} className={`whitespace-pre px-3 py-0.5 ${bg}`}>
                {line.text || " "}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}

export function ArtifactDiffDialog({ open, onOpenChange, artifactId }: Props) {
  const [versions, setVersions] = useState<ArtifactVersionData[]>([]);
  const [vFrom, setVFrom] = useState<number | null>(null);
  const [vTo, setVTo] = useState<number | null>(null);
  const [diff, setDiff] = useState<ArtifactDiffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => a.version_number - b.version_number),
    [versions],
  );

  // Fetch versions and pick sensible defaults when the dialog opens.
  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listArtifactVersions(artifactId);
      setVersions(list);
      const sorted = [...list].sort((a, b) => a.version_number - b.version_number);
      const latest = sorted[sorted.length - 1]?.version_number ?? null;
      const secondLatest = sorted[sorted.length - 2]?.version_number ?? null;
      setVFrom(secondLatest);
      setVTo(latest);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => {
    if (!open) return;
    void loadVersions();
  }, [open, loadVersions]);

  const fetchDiff = useCallback(async () => {
    if (vFrom == null || vTo == null) return;
    setLoading(true);
    setError(null);
    try {
      setDiff(await diffArtifactVersions(artifactId, vFrom, vTo));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [artifactId, vFrom, vTo]);

  useEffect(() => {
    if (!open) return;
    if (vFrom == null || vTo == null) return;
    void fetchDiff();
  }, [open, fetchDiff, vFrom, vTo]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDiff className="h-4 w-4" />
            Compare versions
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">From</span>
            <Select
              value={vFrom != null ? String(vFrom) : ""}
              onValueChange={(v) => setVFrom(Number(v))}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue placeholder="…" />
              </SelectTrigger>
              <SelectContent>
                {sortedVersions.map((v) => (
                  <SelectItem key={v.version_number} value={String(v.version_number)}>
                    v{v.version_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">To</span>
            <Select
              value={vTo != null ? String(vTo) : ""}
              onValueChange={(v) => setVTo(Number(v))}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue placeholder="…" />
              </SelectTrigger>
              <SelectContent>
                {sortedVersions.map((v) => (
                  <SelectItem key={v.version_number} value={String(v.version_number)}>
                    v{v.version_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {vFrom != null && vTo != null && vFrom > vTo && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const f = vFrom;
                setVFrom(vTo);
                setVTo(f);
              }}
              className="ml-auto h-8 text-xs"
            >
              Swap
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading diff…
            </p>
          )}
          {error && !loading && (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          )}
          {!loading && !error && diff && diff.files.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No changes between v{diff.from_version} and v{diff.to_version}.
            </p>
          )}
          {!loading && !error && diff?.files.map((f) => (
            <FileDiffBlock key={f.path} file={f} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
