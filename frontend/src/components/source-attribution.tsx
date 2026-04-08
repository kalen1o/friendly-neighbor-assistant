"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Source } from "@/lib/api";

interface SourceAttributionProps {
  sources: Source[];
}

export function SourceAttribution({ sources }: SourceAttributionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="ml-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {sources.length} {sources.length === 1 ? "source" : "sources"}
      </button>
      <div
        className="grid transition-all duration-200 ease-out"
        style={{
          gridTemplateRows: isOpen ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
            {sources.map((source, i) => (
              <Badge key={i} variant="outline" className="gap-1 text-[11px] font-normal shadow-sm">
                {source.type === "document" ? (
                  <>
                    <FileText className="h-3 w-3 shrink-0 text-primary/70" />
                    <span className="max-w-[140px] truncate">{source.filename}</span>
                    {source.score !== undefined && (
                      <span className="text-muted-foreground/50">
                        {Math.round(source.score * 100)}%
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Globe className="h-3 w-3 shrink-0 text-primary/70" />
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="max-w-[140px] truncate hover:underline"
                      >
                        {source.title || source.url}
                      </a>
                    ) : (
                      <span className="max-w-[140px] truncate">{source.title}</span>
                    )}
                  </>
                )}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
