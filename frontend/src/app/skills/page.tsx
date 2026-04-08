"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Wrench, BookOpen, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
  type SkillOut,
} from "@/lib/api";

const SKILL_TYPE_ICONS: Record<string, typeof Wrench> = {
  tool: Wrench,
  knowledge: BookOpen,
  workflow: GitBranch,
};

function SkillTypeIcon({ type }: { type: string }) {
  const Icon = SKILL_TYPE_ICONS[type] || Wrench;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillOut[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState("tool");
  const [newContent, setNewContent] = useState("");

  const fetchSkills = useCallback(async () => {
    try {
      const data = await listSkills();
      setSkills(data);
    } catch (e) {
      console.error("Failed to fetch skills:", e);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleToggle = async (skill: SkillOut) => {
    if (skill.id === 0) return; // built-in skills without DB record can't be toggled yet
    try {
      await updateSkill(skill.id, { enabled: !skill.enabled });
      await fetchSkills();
    } catch (e) {
      console.error("Failed to toggle skill:", e);
    }
  };

  const handleDelete = async (skill: SkillOut) => {
    if (skill.builtin) return;
    try {
      await deleteSkill(skill.id);
      await fetchSkills();
    } catch (e) {
      console.error("Failed to delete skill:", e);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newDesc.trim()) return;
    setError(null);
    try {
      const content = newContent.trim() || `---\nname: ${newName}\ndescription: ${newDesc}\ntype: ${newType}\nenabled: true\n---\n\n${newDesc}`;
      await createSkill({
        name: newName.trim(),
        description: newDesc.trim(),
        skill_type: newType,
        content,
      });
      setNewName("");
      setNewDesc("");
      setNewType("tool");
      setNewContent("");
      setShowCreate(false);
      await fetchSkills();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create skill");
    }
  };

  const builtinSkills = skills.filter((s) => s.builtin);
  const userSkills = skills.filter((s) => !s.builtin);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Skills</h1>
          <Button onClick={() => setShowCreate(!showCreate)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Skill
          </Button>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {showCreate && (
          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Create New Skill</h3>
            <Input
              placeholder="Skill name (e.g. my_api_caller)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              placeholder="Short description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="tool">Tool</option>
              <option value="knowledge">Knowledge</option>
              <option value="workflow">Workflow</option>
            </select>
            <Textarea
              placeholder="Skill markdown content (instructions, parameters, etc.)"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={6}
            />
            <div className="flex gap-2">
              <Button onClick={handleCreate} size="sm">Create</Button>
              <Button onClick={() => setShowCreate(false)} size="sm" variant="outline">Cancel</Button>
            </div>
          </div>
        )}

        {/* Built-in Skills */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Built-in Skills</h2>
          <div className="rounded-lg border">
            {builtinSkills.map((skill) => (
              <div
                key={skill.name}
                className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SkillTypeIcon type={skill.skill_type} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{skill.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs capitalize text-muted-foreground">{skill.skill_type}</span>
                  <button
                    onClick={() => handleToggle(skill)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      skill.enabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                        skill.enabled ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* User Skills */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Custom Skills</h2>
          {userSkills.length === 0 ? (
            <div className="rounded-lg border py-6 text-center text-sm text-muted-foreground">
              No custom skills yet. Click &ldquo;Add Skill&rdquo; to create one.
            </div>
          ) : (
            <div className="rounded-lg border">
              {userSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <SkillTypeIcon type={skill.skill_type} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{skill.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs capitalize text-muted-foreground">{skill.skill_type}</span>
                    <button
                      onClick={() => handleToggle(skill)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        skill.enabled ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                          skill.enabled ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDelete(skill)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
