"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Clock, Play, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  listSchedules,
  deleteSchedule,
  updateSchedule,
  runScheduleNow,
  type ScheduleData,
} from "@/lib/api";
import { AddScheduleDialog } from "@/components/add-schedule-dialog";

const CRON_PRESETS: Record<string, string> = {
  "0 * * * *": "Every hour",
  "0 9 * * *": "Daily at 9:00 AM",
  "0 9 * * 1": "Weekly on Monday at 9:00 AM",
  "0 9 * * 1-5": "Weekdays at 9:00 AM",
  "0 0 1 * *": "Monthly on the 1st",
};

function humanCron(expr: string): string {
  return CRON_PRESETS[expr] || expr;
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const router = useRouter();

  const fetchSchedules = useCallback(async () => {
    try {
      setSchedules(await listSchedules());
    } catch {
      toast.error("Failed to load schedules");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSchedules()
      .then((data) => { if (!cancelled) setSchedules(data); })
      .catch(() => { if (!cancelled) toast.error("Failed to load schedules"); });
    return () => { cancelled = true; };
  }, []);

  const handleToggle = async (schedule: ScheduleData) => {
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      await fetchSchedules();
    } catch {
      toast.error("Failed to update schedule");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSchedule(id);
      await fetchSchedules();
      toast.success("Schedule deleted");
    } catch {
      toast.error("Failed to delete schedule");
    }
  };

  const handleRun = async (id: string) => {
    try {
      await runScheduleNow(id);
      toast.success("Schedule triggered — check the linked chat for results");
      await fetchSchedules();
    } catch {
      toast.error("Failed to run schedule");
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Scheduled Agents</h1>
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Add Schedule
          </Button>
        </div>

        {schedules.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-8 text-center">
            <Clock className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No scheduled tasks yet. Create one to automate recurring agent tasks.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {schedules.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-500/10">
                    <Clock className="h-5 w-5 text-teal-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant={s.enabled ? "default" : "secondary"} className="text-[10px]">
                        {s.enabled ? "Active" : "Paused"}
                      </Badge>
                      {s.last_status && (
                        <Badge
                          variant={s.last_status === "success" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {s.last_status}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">{s.prompt}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{humanCron(s.cron_expression)}</span>
                      {s.last_run_at && (
                        <span>Last run: {new Date(s.last_run_at).toLocaleString()}</span>
                      )}
                    </div>
                    {s.last_error && (
                      <p className="mt-1 text-xs text-red-500 truncate">{s.last_error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {s.chat_id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => router.push(`/chat/${s.chat_id}`)}
                        title="Open chat"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRun(s.id)}
                      title="Run now"
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleDelete(s.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={() => handleToggle(s)}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <AddScheduleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreated={fetchSchedules}
        />
      </div>
    </div>
  );
}
