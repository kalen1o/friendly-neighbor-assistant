import { AlertTriangle, Info } from "lucide-react"
import * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MessageMetrics } from "@/lib/api"

interface Props {
  metrics: MessageMetrics
}

interface Chip {
  label: string
  tone: "warn" | "info"
}

export function MessageFooter({ metrics }: Props) {
  const chips: Chip[] = []
  if ((metrics.timeouts ?? 0) > 0) {
    chips.push({
      label:
        metrics.timeouts === 1
          ? "1 tool timed out"
          : `${metrics.timeouts} tools timed out`,
      tone: "warn",
    })
  }
  if (metrics.stuck_triggered) {
    chips.push({ label: "Repeated tool calls", tone: "warn" })
  }
  if (metrics.synthesis_fallback) {
    chips.push({ label: "Forced synthesis", tone: "info" })
  }
  if (metrics.max_rounds_hit) {
    chips.push({ label: "Hit round limit", tone: "warn" })
  }

  const hasData =
    metrics.tokens_total != null ||
    metrics.latency != null ||
    chips.length > 0
  if (!hasData) return null

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-xs">
      {chips.map((c, i) => (
        <span
          key={i}
          className={
            c.tone === "warn"
              ? "inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400"
              : "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground"
          }
        >
          <AlertTriangle className="h-3 w-3" />
          {c.label}
        </span>
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Show response details"
              className="rounded text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          }
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          <MetricsTable metrics={metrics} />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function MetricsTable({ metrics }: Props) {
  const rows: { k: string; v: string }[] = []

  if (metrics.provider) rows.push({ k: "Provider", v: metrics.provider })
  if (metrics.rounds_used != null) {
    rows.push({ k: "Rounds", v: String(metrics.rounds_used) })
  }
  if (metrics.tools_called != null) {
    rows.push({
      k: "Tools",
      v:
        metrics.unique_tools != null
          ? `${metrics.tools_called} (${metrics.unique_tools} unique)`
          : String(metrics.tools_called),
    })
  }
  if (
    metrics.tokens_input != null ||
    metrics.tokens_output != null ||
    metrics.tokens_total != null
  ) {
    const parts: string[] = []
    if (metrics.tokens_input != null) parts.push(`${metrics.tokens_input} in`)
    if (metrics.tokens_output != null) parts.push(`${metrics.tokens_output} out`)
    if (metrics.tokens_total != null) parts.push(`${metrics.tokens_total} total`)
    rows.push({ k: "Tokens", v: parts.join(" · ") })
  }
  if (metrics.latency != null) {
    rows.push({ k: "Latency", v: `${metrics.latency.toFixed(2)}s` })
  }
  if (metrics.total_tool_ms != null) {
    rows.push({
      k: "Tool time",
      v: `${(metrics.total_tool_ms / 1000).toFixed(2)}s`,
    })
  }
  if (metrics.slowest_tool_name) {
    rows.push({
      k: "Slowest",
      v:
        metrics.slowest_tool_ms != null
          ? `${metrics.slowest_tool_name} · ${Math.round(metrics.slowest_tool_ms)}ms`
          : metrics.slowest_tool_name,
    })
  }

  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map((r) => (
        <React.Fragment key={r.k}>
          <span className="text-muted-foreground">{r.k}</span>
          <span>{r.v}</span>
        </React.Fragment>
      ))}
    </div>
  )
}
