"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Globe } from "lucide-react";
import type { Source } from "@/lib/api";

interface SourceAttributionProps {
  sources: Source[];
}

export function SourceAttribution({ sources }: SourceAttributionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Sources ({sources.length})
      </button>
      {isOpen && (
        <div className="mt-1.5 space-y-1 pl-4">
          {sources.map((source, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {source.type === "document" ? (
                <>
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{source.filename}</span>
                  {source.score !== undefined && (
                    <span className="shrink-0 text-muted-foreground/60">
                      ({Math.round(source.score * 100)}%)
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Globe className="h-3 w-3 shrink-0" />
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate hover:underline"
                    >
                      {source.title || source.url}
                    </a>
                  ) : (
                    <span className="truncate">{source.title}</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
