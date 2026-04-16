"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Copy, Check, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  type WebhookIntegration,
  type WebhookCreate,
} from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

const PLATFORMS = [
  { value: "slack" as const, label: "Slack", icon: SlackIcon },
  { value: "discord" as const, label: "Discord", icon: DiscordIcon },
  { value: "generic" as const, label: "Generic URL", icon: Globe },
];

const DIRECTIONS = [
  { value: "outbound" as const, label: "Outbound (notifications)" },
  { value: "inbound" as const, label: "Inbound (receive messages)" },
  { value: "both" as const, label: "Both" },
];

const EVENTS = [
  { value: "message_completed", label: "Message completed" },
  { value: "document_processed", label: "Document processed" },
  { value: "task_completed", label: "Task completed" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="ml-1 h-5 w-5 text-muted-foreground hover:text-foreground"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export function IntegrationsSettings() {
  const [webhooks, setWebhooks] = useState<WebhookIntegration[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WebhookCreate>({
    name: "",
    platform: "generic",
    direction: "outbound",
    webhook_url: "",
    subscribed_events: ["message_completed"],
  });
  const [saving, setSaving] = useState(false);

  const load = () => listWebhooks().then(setWebhooks).catch(() => {});

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await createWebhook(form);
      toast.success("Integration created");
      setShowForm(false);
      setForm({ name: "", platform: "generic", direction: "outbound", webhook_url: "", subscribed_events: ["message_completed"] });
      load();
    } catch {
      toast.error("Failed to create integration");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (wh: WebhookIntegration) => {
    try {
      await updateWebhook(wh.id, { enabled: !wh.enabled });
      load();
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhook(id);
      toast.success("Integration deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Integrations</h2>
          <p className="text-sm text-muted-foreground">
            Connect Slack, Discord, or custom webhooks.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {showForm && (
        <div className="mt-4 space-y-3 rounded-lg border p-4">
          <Input
            placeholder="Integration name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="flex gap-2">
            {PLATFORMS.map((p) => (
              <Button
                key={p.value}
                variant={form.platform === p.value ? "outline" : "ghost"}
                size="sm"
                onClick={() => setForm({ ...form, platform: p.value })}
                className={form.platform === p.value ? "border-primary bg-primary/10 text-primary" : ""}
              >
                <p.icon className="h-3.5 w-3.5" />
                {p.label}
              </Button>
            ))}
          </div>
          <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as WebhookCreate["direction"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIRECTIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(form.direction === "outbound" || form.direction === "both") && (
            <Input
              placeholder="Webhook URL (https://...)"
              value={form.webhook_url || ""}
              onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
            />
          )}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Events</p>
            {EVENTS.map((ev) => {
              const checked = form.subscribed_events?.includes(ev.value) ?? false;
              return (
                <Label key={ev.value} className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => {
                      const events = form.subscribed_events || [];
                      setForm({
                        ...form,
                        subscribed_events: c
                          ? [...events, ev.value]
                          : events.filter((x) => x !== ev.value),
                      });
                    }}
                  />
                  {ev.label}
                </Label>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={saving || !form.name.trim()} onClick={handleCreate}>
              {saving ? "Creating..." : "Create"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {webhooks.length === 0 && !showForm && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No integrations configured yet.
          </p>
        )}
        {webhooks.map((wh) => {
          const PlatformIcon = PLATFORMS.find((p) => p.value === wh.platform)?.icon || Globe;
          return (
            <div key={wh.id} className="flex items-center gap-3 rounded-lg border p-3">
              <PlatformIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{wh.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {wh.direction} &middot; {wh.subscribed_events.join(", ") || "no events"}
                </p>
                {wh.inbound_url && (
                  <div className="mt-1 flex items-center text-[10px] text-muted-foreground">
                    <span className="truncate font-mono">{API_BASE}{wh.inbound_url}</span>
                    <CopyButton text={`${API_BASE}${wh.inbound_url}`} />
                  </div>
                )}
              </div>
              <Badge
                variant="outline"
                className={`cursor-pointer text-[10px] ${
                  wh.enabled ? "border-green-500/30 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : ""
                }`}
                onClick={() => handleToggle(wh)}
              >
                {wh.enabled ? "Active" : "Off"}
              </Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(wh.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
