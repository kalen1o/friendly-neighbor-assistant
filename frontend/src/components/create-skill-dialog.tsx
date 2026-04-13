"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Wrench, BookOpen, GitBranch, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { createSkill } from "@/lib/api";

const SKILL_TYPE_ICONS: Record<string, typeof Wrench> = {
  tool: Wrench,
  knowledge: BookOpen,
  workflow: GitBranch,
};

export function SkillTypeIcon({ type }: { type: string }) {
  const Icon = SKILL_TYPE_ICONS[type] || Wrench;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

// ── Form schema ──

const skillSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Only lowercase letters, numbers, and underscores"),
  description: z.string().min(1, "Description is required").max(200),
  skill_type: z.enum(["tool", "knowledge", "workflow"]),
  content: z.string().min(1, "Content is required"),
});

type SkillFormData = z.infer<typeof skillSchema>;

// ── Create Skill Dialog ──

export function CreateSkillDialog({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SkillFormData>({
    resolver: zodResolver(skillSchema),
    defaultValues: {
      name: "",
      description: "",
      skill_type: "tool",
      content: "",
    },
  });

  const onSubmit = async (data: SkillFormData) => {
    setError(null);
    try {
      // Auto-generate markdown if content doesn't have frontmatter
      let content = data.content;
      if (!content.startsWith("---")) {
        content = `---\nname: ${data.name}\ndescription: ${data.description}\ntype: ${data.skill_type}\nenabled: true\n---\n\n${content}`;
      }
      await createSkill({
        name: data.name,
        description: data.description,
        skill_type: data.skill_type,
        content,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create skill");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { reset(); setError(null); } }}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-4 w-4" />
        Add Skill
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Skill</DialogTitle>
          <DialogDescription>
            Define a new skill for the AI agent. Skills are markdown files with instructions.
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
              placeholder="my_custom_skill"
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
              placeholder="What this skill does (shown to the agent)"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              defaultValue="tool"
              onValueChange={(val) => setValue("skill_type", val as SkillFormData["skill_type"])}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tool">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5" />
                    Tool — executes an action
                  </div>
                </SelectItem>
                <SelectItem value="knowledge">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5" />
                    Knowledge — adds expertise
                  </div>
                </SelectItem>
                <SelectItem value="workflow">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5" />
                    Workflow — multi-step task
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Instructions (Markdown)</Label>
            <Textarea
              id="content"
              placeholder={"## When to use\nWhen the user asks about...\n\n## Instructions\n1. Do this\n2. Then that"}
              rows={8}
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
              {isSubmitting ? "Creating..." : "Create Skill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
