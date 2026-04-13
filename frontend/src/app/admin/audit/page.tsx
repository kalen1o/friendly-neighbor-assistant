"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// icons used in ACTION_COLORS badges only
import { AdminGuard } from "@/components/admin-guard";
import { AdminNav } from "@/components/admin-nav";
import { adminGetAudit, type AuditEntry } from "@/lib/api";

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

const ACTION_OPTIONS = [
  "All",
  "login",
  "logout",
  "register",
  "send_message",
  "create_chat",
  "delete_chat",
  "admin_promote",
  "admin_demote",
  "admin_delete_user",
];

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [action, setAction] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminGetAudit(undefined, action || undefined);
      setEntries(data.entries);
      setCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [action]);

  const fetchMore = useCallback(async () => {
    if (!hasMore || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await adminGetAudit(cursor, action || undefined);
      setEntries((prev) => [...prev, ...data.entries]);
      setCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch {
      // ignore
    }
    setLoadingMore(false);
  }, [hasMore, cursor, loadingMore, action]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInitial();
  }, [fetchInitial]);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void fetchMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchMore]);

  const handleActionChange = (value: string) => {
    setAction(value === "All" ? "" : value);
  };

  return (
    <AdminGuard>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <AdminNav />
        <h1 className="mb-1 text-xl font-semibold">Audit Log</h1>
        <p className="mb-6 text-sm text-muted-foreground">System activity and event history</p>

        {/* Filter */}
        <div className="mb-4">
          <select
            value={action || "All"}
            onChange={(e) => handleActionChange(e.target.value)}
            className="rounded border bg-transparent px-3 py-2 text-sm"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "All" ? "All Actions" : opt}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No audit entries found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Resource</th>
                  <th className="px-3 py-2 text-left">IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
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
                      {entry.resource_type
                        ? `${entry.resource_type}${entry.resource_id ? `:${entry.resource_id}` : ""}`
                        : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                      {entry.ip_address || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-4" />
        {loadingMore && (
          <div className="py-4 text-center text-sm text-muted-foreground">Loading more...</div>
        )}
      </div>
    </AdminGuard>
  );
}
