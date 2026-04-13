"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { AdminGuard } from "@/components/admin-guard";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  adminListQuotas,
  adminSetQuota,
  adminDeleteQuota,
  adminListUsers,
  type UserQuotaOut,
  type UserAdmin,
} from "@/lib/api";

interface QuotaForm {
  messages_soft: string;
  messages_hard: string;
  tokens_soft: string;
  tokens_hard: string;
}

const emptyForm: QuotaForm = {
  messages_soft: "",
  messages_hard: "",
  tokens_soft: "",
  tokens_hard: "",
};

function parseNum(v: string): number | null {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function UsageBar({ used, hard }: { used: number; hard: number | null }) {
  if (!hard || hard <= 0) {
    return <span className="text-xs text-muted-foreground">No limit</span>;
  }
  const pct = Math.min((used / hard) * 100, 100);
  const color =
    pct > 80
      ? "bg-red-500"
      : pct > 50
        ? "bg-yellow-500"
        : "bg-green-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}

export default function AdminQuotasPage() {
  const [quotas, setQuotas] = useState<UserQuotaOut[]>([]);
  const [users, setUsers] = useState<UserAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<QuotaForm>(emptyForm);
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [addForm, setAddForm] = useState<QuotaForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const { confirm, dialogProps } = useConfirm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [quotaData, userData] = await Promise.all([
        adminListQuotas(),
        adminListUsers(),
      ]);
      setQuotas(quotaData);
      setUsers(userData);
    } catch {
      toast.error("Failed to load data");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  const startEdit = (q: UserQuotaOut) => {
    setEditingId(q.user_id);
    setEditForm({
      messages_soft: q.messages_soft?.toString() ?? "",
      messages_hard: q.messages_hard?.toString() ?? "",
      tokens_soft: q.tokens_soft?.toString() ?? "",
      tokens_hard: q.tokens_hard?.toString() ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
  };

  const saveEdit = async (userId: string) => {
    setSaving(true);
    try {
      const updated = await adminSetQuota(userId, {
        messages_soft: parseNum(editForm.messages_soft),
        messages_hard: parseNum(editForm.messages_hard),
        tokens_soft: parseNum(editForm.tokens_soft),
        tokens_hard: parseNum(editForm.tokens_hard),
      });
      setQuotas((prev) => prev.map((q) => (q.user_id === userId ? updated : q)));
      setEditingId(null);
      toast.success("Quota updated");
    } catch {
      toast.error("Failed to update quota");
    }
    setSaving(false);
  };

  const handleDelete = async (userId: string) => {
    try {
      await adminDeleteQuota(userId);
      setQuotas((prev) => prev.filter((q) => q.user_id !== userId));
      toast.success("Quota removed");
    } catch {
      toast.error("Failed to delete quota");
    }
  };

  const handleAdd = async () => {
    if (!addUserId) {
      toast.error("Please select a user");
      return;
    }
    setSaving(true);
    try {
      const created = await adminSetQuota(addUserId, {
        messages_soft: parseNum(addForm.messages_soft),
        messages_hard: parseNum(addForm.messages_hard),
        tokens_soft: parseNum(addForm.tokens_soft),
        tokens_hard: parseNum(addForm.tokens_hard),
      });
      setQuotas((prev) => {
        const existing = prev.findIndex((q) => q.user_id === addUserId);
        if (existing >= 0) {
          const copy = [...prev];
          copy[existing] = created;
          return copy;
        }
        return [...prev, created];
      });
      setShowAdd(false);
      setAddSearch("");
      setAddUserId("");
      setAddForm(emptyForm);
      toast.success("Quota added");
    } catch {
      toast.error("Failed to add quota");
    }
    setSaving(false);
  };

  // Users that don't already have a quota
  const quotaUserIds = new Set(quotas.map((q) => q.user_id));
  const availableUsers = users.filter(
    (u) => !quotaUserIds.has(u.id) && (
      !addSearch ||
      u.name.toLowerCase().includes(addSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(addSearch.toLowerCase())
    )
  );

  return (
    <AdminGuard>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <AdminNav />
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-1 text-xl font-semibold">Quotas</h1>
            <p className="text-sm text-muted-foreground">Set usage limits per user</p>
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)} disabled={showAdd}>
            <Plus className="mr-1 h-4 w-4" />
            Add Quota
          </Button>
        </div>

        {/* Add quota form */}
        {showAdd && (
          <div className="mb-4 rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-medium">Add Quota</h3>
            <div className="mb-3">
              <Input
                placeholder="Search user by name or email..."
                value={addSearch}
                onChange={(e) => {
                  setAddSearch(e.target.value);
                  setAddUserId("");
                }}
              />
              {addSearch && availableUsers.length > 0 && !addUserId && (
                <div className="mt-1 max-h-32 overflow-y-auto rounded border bg-popover">
                  {availableUsers.slice(0, 10).map((u) => (
                    <button
                      key={u.id}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted/50"
                      onClick={() => {
                        setAddUserId(u.id);
                        setAddSearch(`${u.name} (${u.email})`);
                      }}
                    >
                      {u.name} <span className="text-muted-foreground">({u.email})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Msg Soft</label>
                <Input
                  type="number"
                  value={addForm.messages_soft}
                  onChange={(e) => setAddForm({ ...addForm, messages_soft: e.target.value })}
                  placeholder="--"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Msg Hard</label>
                <Input
                  type="number"
                  value={addForm.messages_hard}
                  onChange={(e) => setAddForm({ ...addForm, messages_hard: e.target.value })}
                  placeholder="--"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Tok Soft</label>
                <Input
                  type="number"
                  value={addForm.tokens_soft}
                  onChange={(e) => setAddForm({ ...addForm, tokens_soft: e.target.value })}
                  placeholder="--"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Tok Hard</label>
                <Input
                  type="number"
                  value={addForm.tokens_hard}
                  onChange={(e) => setAddForm({ ...addForm, tokens_hard: e.target.value })}
                  placeholder="--"
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={saving || !addUserId}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowAdd(false);
                  setAddSearch("");
                  setAddUserId("");
                  setAddForm(emptyForm);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : quotas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No quotas configured.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-right">Messages (soft/hard)</th>
                  <th className="px-3 py-2 text-right">Tokens (soft/hard)</th>
                  <th className="px-3 py-2 text-left">Usage</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotas.map((q) => {
                  const isEditing = editingId === q.user_id;

                  return (
                    <tr key={q.user_id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="font-medium">{q.user_name}</div>
                        <div className="text-xs text-muted-foreground">{q.user_email}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              value={editForm.messages_soft}
                              onChange={(e) => setEditForm({ ...editForm, messages_soft: e.target.value })}
                              className="w-20 text-right text-xs"
                              placeholder="--"
                            />
                            <span className="text-muted-foreground">/</span>
                            <Input
                              type="number"
                              value={editForm.messages_hard}
                              onChange={(e) => setEditForm({ ...editForm, messages_hard: e.target.value })}
                              className="w-20 text-right text-xs"
                              placeholder="--"
                            />
                          </div>
                        ) : (
                          <span className="font-mono text-xs">
                            {q.messages_soft ?? "--"} / {q.messages_hard ?? "--"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              value={editForm.tokens_soft}
                              onChange={(e) => setEditForm({ ...editForm, tokens_soft: e.target.value })}
                              className="w-20 text-right text-xs"
                              placeholder="--"
                            />
                            <span className="text-muted-foreground">/</span>
                            <Input
                              type="number"
                              value={editForm.tokens_hard}
                              onChange={(e) => setEditForm({ ...editForm, tokens_hard: e.target.value })}
                              className="w-20 text-right text-xs"
                              placeholder="--"
                            />
                          </div>
                        ) : (
                          <span className="font-mono text-xs">
                            {q.tokens_soft?.toLocaleString() ?? "--"} / {q.tokens_hard?.toLocaleString() ?? "--"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <UsageBar used={q.messages_used} hard={q.messages_hard} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => saveEdit(q.user_id)}
                              disabled={saving}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(q)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => confirm(() => handleDelete(q.user_id))}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <ConfirmDialog
          {...dialogProps}
          title="Remove Quota"
          description="Are you sure you want to remove this user's quota? They will have unlimited access."
        />
      </div>
    </AdminGuard>
  );
}
