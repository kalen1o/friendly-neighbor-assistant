"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Coins, FileText, Globe, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Source, MessageMetrics } from "@/lib/api";

interface SourceAttributionProps {
  sources: Source[];
  metrics?: MessageMetrics | null;
}

export function SourceAttribution({ sources, metrics }: SourceAttributionProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasSources = sources && sources.length > 0;
  if (!hasSources && !metrics) return null;

  return (
    <div className="ml-1">
      <div className="flex items-center gap-2">
        {hasSources && (
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
        )}
        {metrics && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            {metrics.latency !== undefined && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {metrics.latency}s
              </span>
            )}
            {metrics.tokens_total !== undefined && (
              <span className="flex items-center gap-0.5">
                <Coins className="h-2.5 w-2.5" />
                {metrics.tokens_input}+{metrics.tokens_output}={metrics.tokens_total}
              </span>
            )}
          </div>
        )}
      </div>
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
                ) : source.type === "skill" ? (
                  <>
                    <Wrench className="h-3 w-3 shrink-0 text-primary/70" />
                    <span className="max-w-[140px] truncate">{source.tool?.replace(/_/g, " ") || "skill"}</span>
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
