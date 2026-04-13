"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  Activity,
  MessageSquare,
  Zap,
  DollarSign,
  ArrowRight,
  ScrollText,
  Gauge,
} from "lucide-react";
import { AdminGuard } from "@/components/admin-guard";
import { AdminNav } from "@/components/admin-nav";
import { Card, CardContent } from "@/components/ui/card";
import {
  adminGetAnalytics,
  adminGetAudit,
  type SystemAnalytics,
  type AuditEntry,
} from "@/lib/api";

const ACTION_COLORS: Record<string, string> = {
  login: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  logout: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  register: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  send_message: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  create_chat: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  delete_chat: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  admin_promote: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  admin_demote: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  admin_delete_user: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  admin_set_quota: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export default function AdminDashboardPage() {
  const [analytics, setAnalytics] = useState<SystemAnalytics | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsData, auditData] = await Promise.all([
        adminGetAnalytics(30),
        adminGetAudit(undefined, undefined),
      ]);
      setAnalytics(analyticsData);
      setRecentAudit(auditData.entries.slice(0, 20));
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  const summaryCards = analytics
    ? [
        { icon: Users, label: "Total Users", value: analytics.total_users },
        { icon: Activity, label: "Active 30d", value: analytics.active_users_30d },
        { icon: MessageSquare, label: "Messages", value: analytics.total_messages.toLocaleString() },
        { icon: Zap, label: "Tokens", value: formatTokens(analytics.total_tokens) },
        { icon: DollarSign, label: "Cost", value: formatCost(analytics.total_cost) },
      ]
    : [];

  const quickLinks = [
    { href: "/admin/users", icon: Users, label: "User Management", description: "Manage users, roles, and access" },
    { href: "/admin/audit", icon: ScrollText, label: "Audit Log", description: "View system activity log" },
    { href: "/admin/quotas", icon: Gauge, label: "Quota Management", description: "Set usage limits per user" },
  ];

  return (
    <AdminGuard>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <AdminNav />
        <h1 className="mb-1 text-xl font-semibold">Dashboard</h1>
        <p className="mb-6 text-sm text-muted-foreground">System overview and management</p>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {summaryCards.map((s) => (
                <Card key={s.label}>
                  <CardContent>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <s.icon className="h-4 w-4" />
                      <span className="text-xs">{s.label}</span>
                    </div>
                    <p className="mt-1 text-2xl font-semibold">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Quick links */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {quickLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  <Card className="cursor-pointer transition-colors hover:bg-muted/50">
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <link.icon className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">{link.label}</span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{link.description}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {/* Recent audit entries */}
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Recent Activity</h2>
                <Link href="/admin/audit" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              {recentAudit.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No audit entries found.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                        <th className="px-3 py-2 text-left">Time</th>
                        <th className="px-3 py-2 text-left">User</th>
                        <th className="px-3 py-2 text-left">Action</th>
                        <th className="px-3 py-2 text-left">Resource</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentAudit.map((entry) => (
                        <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                            {new Date(entry.created_at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-3 py-2 text-xs">{entry.user_email || "-"}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                                ACTION_COLORS[entry.action] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              }`}
                            >
                              {entry.action}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {entry.resource_type ? `${entry.resource_type}${entry.resource_id ? `:${entry.resource_id}` : ""}` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminGuard>
  );
}
