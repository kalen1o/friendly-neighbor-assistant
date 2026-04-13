"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { AdminGuard } from "@/components/admin-guard";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { useAuth } from "@/components/auth-guard";
import { toast } from "sonner";
import {
  adminListUsers,
  adminUpdateUser,
  adminDeleteUser,
  type UserAdmin,
} from "@/lib/api";

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { confirm, dialogProps } = useConfirm();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListUsers();
      setUsers(data);
    } catch {
      toast.error("Failed to load users");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      const updated = await adminUpdateUser(userId, { role });
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      toast.success("Role updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const handleStatusChange = async (userId: string, isActive: boolean) => {
    try {
      const updated = await adminUpdateUser(userId, { is_active: isActive });
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      toast.success(isActive ? "User activated" : "User deactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      await adminDeleteUser(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  return (
    <AdminGuard>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <AdminNav />
        <h1 className="mb-1 text-xl font-semibold">Users</h1>
        <p className="mb-6 text-sm text-muted-foreground">Manage users, roles, and access</p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No users found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-right">Messages</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-left">Joined</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  const isEnvAdmin = u.is_env_admin;

                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{u.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                      <td className="px-3 py-2">
                        {isEnvAdmin ? (
                          <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            Env Admin
                          </span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className="rounded border bg-transparent px-2 py-1 text-xs"
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                            <option value="viewer">viewer</option>
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Switch
                          checked={u.is_active}
                          onCheckedChange={(checked) => handleStatusChange(u.id, checked)}
                          disabled={isEnvAdmin}
                          size="sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {u.messages_this_month.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {u.tokens_this_month.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {!isEnvAdmin && !isSelf && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              confirm(() => handleDelete(u.id))
                            }
                          >
                            Delete
                          </Button>
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
          title="Delete User"
          description="Are you sure you want to delete this user? This action cannot be undone."
        />
      </div>
    </AdminGuard>
  );
}
