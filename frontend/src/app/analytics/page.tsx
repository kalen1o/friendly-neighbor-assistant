"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, MessageSquare, Zap, DollarSign, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAnalytics, type AnalyticsResponse } from "@/lib/api";
import { useAuth } from "@/components/auth-guard";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatLatency(s: number | null): string {
  if (s === null) return "-";
  return `${s.toFixed(1)}s`;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { date: string; messages: number; tokens_total: number; cost_total: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{d.date}</p>
      <p className="text-muted-foreground">{d.messages} messages</p>
      <p className="text-muted-foreground">{formatTokens(d.tokens_total)} tokens</p>
      <p className="text-muted-foreground">{formatCost(d.cost_total)}</p>
    </div>
  );
}

function DailyChart({ daily }: { daily: AnalyticsResponse["daily"] }) {
  if (daily.length === 0) {
    return (
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Daily Usage</h2>
        <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed">
          <p className="text-xs text-muted-foreground">
            Usage data will appear here as you chat
          </p>
        </div>
      </div>
    );
  }

  const chartData = daily.map((d) => ({
    ...d,
    label: d.date.slice(5), // "04-10"
  }));

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-sm font-semibold">Daily Usage</h2>
      <div className="rounded-lg border p-4 text-muted-foreground" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTokens}
              width={55}
              label={{ value: "Tokens", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "currentColor" } }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "currentColor", opacity: 0.1 }} />
            <Bar
              dataKey="tokens_total"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { requireAuth } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async () => {
    const authed = await requireAuth();
    if (!authed) return;
    setLoading(true);
    try {
      const result = await getAnalytics(days);
      setData(result);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [requireAuth, days]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!data) return null;

  const summaryCards = [
    { icon: MessageSquare, label: "Messages", value: data.summary.total_messages },
    { icon: Zap, label: "Tokens", value: formatTokens(data.summary.tokens_total) },
    { icon: DollarSign, label: "Cost", value: formatCost(data.summary.cost_total) },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Usage Analytics</h1>
            <p className="text-sm text-muted-foreground">{data.period}</p>
          </div>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {summaryCards.map((s) => (
          <div key={s.label} className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <s.icon className="h-4 w-4" />
              <span className="text-xs">{s.label}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Cost breakdown */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Input tokens</p>
          <p className="text-lg font-semibold">{formatTokens(data.summary.tokens_input)}</p>
          <p className="text-xs text-muted-foreground">{formatCost(data.summary.cost_input)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Output tokens</p>
          <p className="text-lg font-semibold">{formatTokens(data.summary.tokens_output)}</p>
          <p className="text-xs text-muted-foreground">{formatCost(data.summary.cost_output)}</p>
        </div>
      </div>

      {/* Daily chart */}
      <DailyChart daily={data.daily} />

      {/* Per-message table */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Message History</h2>
        {data.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages with token data found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left">Chat</th>
                  <th className="px-3 py-2 text-right">Input</th>
                  <th className="px-3 py-2 text-right">Output</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Latency</th>
                  <th className="px-3 py-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.messages.slice(0, 50).map((m) => (
                  <tr
                    key={m.message_id}
                    className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                    onClick={() => router.push(`/chat/${m.chat_id}`)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 max-w-[200px]">
                        <span className="truncate text-sm">{m.chat_title || "Untitled"}</span>
                        <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{m.tokens_input.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{m.tokens_output.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-medium">{m.tokens_total.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCost(m.cost_total)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{formatLatency(m.latency)}</td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(m.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.messages.length > 50 && (
              <div className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
                Showing 50 of {data.messages.length} messages
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
