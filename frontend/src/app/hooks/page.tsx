"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Lock } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CreateHookDialog, HookTypeIcon, HOOK_POINTS } from "@/components/create-hook-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  deleteHook,
  listHooks,
  updateHook,
  type HookOut,
} from "@/lib/api";

// ── Hooks Page ──

export default function HooksPage() {
  const [hooks, setHooks] = useState<HookOut[]>([]);

  const fetchHooks = useCallback(async () => {
    try {
      setHooks(await listHooks());
    } catch (e) {
      console.error("Failed to fetch hooks:", e);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchHooks();
  }, [fetchHooks]);

  const handleToggle = async (hook: HookOut) => {
    if (hook.builtin) return;
    try {
      await updateHook(hook.id, { enabled: !hook.enabled });
      await fetchHooks();
    } catch (e) {
      console.error("Failed to toggle hook:", e);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<HookOut | null>(null);

  const handleDelete = async (hook: HookOut) => {
    if (hook.builtin) return;
    try {
      await deleteHook(hook.id);
      await fetchHooks();
    } catch (e) {
      console.error("Failed to delete hook:", e);
    }
  };

  // Group by hook_point
  const grouped: Record<string, HookOut[]> = {};
  for (const point of HOOK_POINTS) {
    const pointHooks = hooks.filter((h) => h.hook_point === point);
    if (pointHooks.length > 0) grouped[point] = pointHooks;
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Hooks</h1>
          <CreateHookDialog onCreated={fetchHooks} />
        </div>

        {Object.entries(grouped).map(([point, pointHooks]) => (
          <div key={point}>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">{point}</h2>
            <Card>
              <CardContent className="divide-y p-0">
                {pointHooks.map((hook) => (
                  <div
                    key={hook.name}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <HookTypeIcon type={hook.hook_type} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{hook.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{hook.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">pri:{hook.priority}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{hook.hook_type}</Badge>
                      {hook.builtin ? (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Lock className="h-3 w-3" />
                          Built-in
                        </Badge>
                      ) : (
                        <>
                          <Switch
                            checked={hook.enabled}
                            onCheckedChange={() => handleToggle(hook)}
                            size="sm"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeleteTarget(hook)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No hooks found.
            </CardContent>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete hook?"
        description={`"${deleteTarget?.name}" will be permanently deleted.`}
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); }}
      />
    </div>
  );
}
