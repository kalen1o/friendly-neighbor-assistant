"use client";

import { useState } from "react";
import { Clock, ChevronDown, Repeat, CalendarDays, BriefcaseBusiness, Calendar1, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createSchedule } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *", icon: Timer, description: "Runs at the top of every hour" },
  { label: "Daily at 9 AM", value: "0 9 * * *", icon: CalendarDays, description: "Every day at 9:00 AM" },
  { label: "Weekdays at 9 AM", value: "0 9 * * 1-5", icon: BriefcaseBusiness, description: "Monday through Friday at 9:00 AM" },
  { label: "Weekly on Monday", value: "0 9 * * 1", icon: Repeat, description: "Every Monday at 9:00 AM" },
  { label: "Monthly on the 1st", value: "0 0 1 * *", icon: Calendar1, description: "First day of each month at midnight" },
];

interface AddScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function AddScheduleDialog({ open, onOpenChange, onCreated }: AddScheduleDialogProps) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("0 9 * * *");
  const [customCron, setCustomCron] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);

  const cron = isCustom ? customCron : selectedPreset;

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim() || !cron.trim()) {
      toast.error("Name, prompt, and schedule are required");
      return;
    }
    setLoading(true);
    try {
      await createSchedule({
        name: name.trim(),
        prompt: prompt.trim(),
        cron_expression: cron.trim(),
        webhook_url: webhookUrl.trim() || undefined,
      });
      toast.success("Schedule created");
      onCreated();
      onOpenChange(false);
      setName("");
      setPrompt("");
      setSelectedPreset("0 9 * * *");
      setCustomCron("");
      setIsCustom(false);
      setWebhookUrl("");
      setShowAdvanced(false);
    } catch {
      toast.error("Failed to create schedule");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10">
              <Clock className="h-5 w-5 text-teal-500" />
            </div>
            <div>
              <DialogTitle>New Scheduled Agent</DialogTitle>
              <DialogDescription>
                Automate a recurring task — the agent will run on your chosen schedule.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Name</Label>
            <Input
              id="sched-name"
              placeholder="e.g. Daily AI News Digest"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-prompt">Prompt</Label>
            <Textarea
              id="sched-prompt"
              className="min-h-[80px] resize-none"
              placeholder="Search the web for the latest AI news and summarize the top 5 stories with links"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
            <p className="text-[11px] text-muted-foreground/60">
              The agent will execute this prompt each time the schedule fires.
            </p>
          </div>

          {/* Schedule presets */}
          <div className="space-y-2">
            <Label>Schedule</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {CRON_PRESETS.map((preset) => {
                const Icon = preset.icon;
                const active = !isCustom && selectedPreset === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setSelectedPreset(preset.value);
                      setIsCustom(false);
                    }}
                    className={cn(
                      "group flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-all",
                      active
                        ? "border-teal-500/40 bg-teal-500/5 ring-1 ring-teal-500/20"
                        : "border-border hover:border-muted-foreground/30 hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className={cn(
                        "h-3.5 w-3.5",
                        active ? "text-teal-500" : "text-muted-foreground/60"
                      )} />
                      <span className={cn(
                        "text-xs font-medium",
                        active ? "text-teal-700 dark:text-teal-400" : "text-foreground"
                      )}>
                        {preset.label}
                      </span>
                    </div>
                  </button>
                );
              })}
              {/* Custom option */}
              <button
                type="button"
                onClick={() => setIsCustom(true)}
                className={cn(
                  "group flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-all",
                  isCustom
                    ? "border-teal-500/40 bg-teal-500/5 ring-1 ring-teal-500/20"
                    : "border-border hover:border-muted-foreground/30 hover:bg-accent/50"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Clock className={cn(
                    "h-3.5 w-3.5",
                    isCustom ? "text-teal-500" : "text-muted-foreground/60"
                  )} />
                  <span className={cn(
                    "text-xs font-medium",
                    isCustom ? "text-teal-700 dark:text-teal-400" : "text-foreground"
                  )}>
                    Custom
                  </span>
                </div>
              </button>
            </div>

            {isCustom && (
              <div className="space-y-1.5 pt-1">
                <Input
                  placeholder="*/5 * * * *"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground/60">
                  Use standard cron syntax: minute hour day month weekday
                </p>
              </div>
            )}

            {!isCustom && selectedPreset && (
              <p className="text-[11px] text-muted-foreground/60">
                {CRON_PRESETS.find((p) => p.value === selectedPreset)?.description}
              </p>
            )}
          </div>

          {/* Advanced toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={cn(
                "h-3.5 w-3.5 transition-transform",
                showAdvanced && "rotate-180"
              )} />
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="sched-webhook">Webhook URL</Label>
                <Input
                  id="sched-webhook"
                  placeholder="https://hooks.slack.com/services/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground/60">
                  Optionally post results to a Slack or webhook endpoint.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !prompt.trim() || !cron.trim()}
          >
            {loading ? "Creating..." : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
