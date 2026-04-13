"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Lock } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CreateSkillDialog, SkillTypeIcon } from "@/components/create-skill-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  deleteSkill,
  listSkills,
  updateSkill,
  type SkillOut,
} from "@/lib/api";

// ── Skills Page ──

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillOut[]>([]);

  const fetchSkills = useCallback(async () => {
    try {
      const data = await listSkills();
      setSkills(data);
    } catch (e) {
      console.error("Failed to fetch skills:", e);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSkills();
  }, [fetchSkills]);

  const handleToggle = async (skill: SkillOut) => {
    if (skill.builtin) return;
    try {
      await updateSkill(skill.id, { enabled: !skill.enabled });
      await fetchSkills();
    } catch (e) {
      console.error("Failed to toggle skill:", e);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<SkillOut | null>(null);

  const handleDelete = async (skill: SkillOut) => {
    if (skill.builtin) return;
    try {
      await deleteSkill(skill.id);
      await fetchSkills();
    } catch (e) {
      console.error("Failed to delete skill:", e);
    }
  };

  const builtinSkills = skills.filter((s) => s.builtin);
  const userSkills = skills.filter((s) => !s.builtin);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Skills</h1>
          <CreateSkillDialog onCreated={fetchSkills} />
        </div>

        {/* Built-in Skills */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Built-in Skills</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {builtinSkills.map((skill) => (
                <div
                  key={skill.name}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <SkillTypeIcon type={skill.skill_type} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{skill.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{skill.skill_type}</Badge>
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Lock className="h-3 w-3" />
                      Built-in
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* User Skills */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Custom Skills</h2>
          {userSkills.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No custom skills yet. Click &ldquo;Add Skill&rdquo; to create one.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="divide-y p-0">
                {userSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <SkillTypeIcon type={skill.skill_type} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{skill.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{skill.skill_type}</Badge>
                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={() => handleToggle(skill)}
                        size="sm"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDeleteTarget(skill)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete skill?"
        description={`"${deleteTarget?.name}" will be permanently deleted.`}
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); }}
      />
    </div>
  );
}
