"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Eye, Shield, Wand2, Lock, AlertCircle, Anchor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createHook,
  deleteHook,
  listHooks,
  updateHook,
  type HookOut,
} from "@/lib/api";

const HOOK_TYPE_ICONS: Record<string, typeof Eye> = {
  observability: Eye,
  control: Shield,
  transformation: Wand2,
};

const HOOK_POINTS = [
  "pre_message",
  "pre_skills",
  "post_skills",
  "pre_llm",
  "post_llm",
  "post_message",
];

function HookTypeIcon({ type }: { type: string }) {
  const Icon = HOOK_TYPE_ICONS[type] || Anchor;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

// ── Form schema ──

const hookSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Only lowercase letters, numbers, and underscores"),
  description: z.string().min(1, "Description is required").max(200),
  hook_type: z.enum(["observability", "control", "transformation"]),
  hook_point: z.enum(["pre_message", "pre_skills", "post_skills", "pre_llm", "post_llm", "post_message"]),
  priority: z.number().int().min(0).max(1000),
  content: z.string().min(1, "Content is required"),
});

type HookFormData = z.infer<typeof hookSchema>;

// ── Create Hook Dialog ──

function CreateHookDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<HookFormData>({
    resolver: zodResolver(hookSchema),
    defaultValues: {
      name: "",
      description: "",
      hook_type: "observability",
      hook_point: "post_message",
      priority: 100,
      content: "",
    },
  });

  const onSubmit = async (data: HookFormData) => {
    setError(null);
    try {
      let content = data.content;
      if (!content.startsWith("---")) {
        content = `---\nname: ${data.name}\ndescription: ${data.description}\ntype: ${data.hook_type}\nhook_point: ${data.hook_point}\npriority: ${data.priority}\nenabled: true\n---\n\n${content}`;
      }
      await createHook({ ...data, content });
      reset();
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create hook");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { reset(); setError(null); } }}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-4 w-4" />
        Add Hook
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Hook</DialogTitle>
          <DialogDescription>
            Define a hook that fires at a specific point in the message flow.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="my_custom_hook"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="What this hook does"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                defaultValue="observability"
                onValueChange={(val) => setValue("hook_type", val as HookFormData["hook_type"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="observability">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3.5 w-3.5" />
                      Observability
                    </div>
                  </SelectItem>
                  <SelectItem value="control">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5" />
                      Control
                    </div>
                  </SelectItem>
                  <SelectItem value="transformation">
                    <div className="flex items-center gap-2">
                      <Wand2 className="h-3.5 w-3.5" />
                      Transformation
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Hook Point</Label>
              <Select
                defaultValue="post_message"
                onValueChange={(val) => setValue("hook_point", val as HookFormData["hook_point"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_POINTS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority (lower runs first)</Label>
            <Input id="priority" type="number" {...register("priority", { valueAsNumber: true })} />
            {errors.priority && (
              <p className="text-xs text-destructive">{errors.priority.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Instructions (Markdown)</Label>
            <Textarea
              id="content"
              placeholder="## Action\nDescribe what this hook should do..."
              rows={6}
              className="font-mono text-xs"
              {...register("content")}
            />
            {errors.content && (
              <p className="text-xs text-destructive">{errors.content.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Hook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
    void fetchHooks();
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
                            onClick={() => handleDelete(hook)}
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
    </div>
  );
}
