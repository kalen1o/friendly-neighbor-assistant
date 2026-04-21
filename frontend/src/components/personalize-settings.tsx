"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getMe, updateMe } from "@/lib/api";
import { toast } from "sonner";

type FormState = {
  nickname: string;
  role: string;
  tone: string;
  length: string;
  language: string;
  about: string;
  style: string;
};

const EMPTY: FormState = {
  nickname: "",
  role: "",
  tone: "",
  length: "",
  language: "",
  about: "",
  style: "",
};

const TONE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "casual", label: "Casual" },
  { value: "friendly", label: "Friendly" },
  { value: "formal", label: "Formal" },
  { value: "technical", label: "Technical" },
  { value: "concise", label: "Concise" },
];

const LENGTH_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

const ABOUT_MAX = 1500;
const STYLE_MAX = 1500;

export function PersonalizeSettings() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMe()
      .then((u) => {
        const next: FormState = {
          nickname: u.personalization_nickname ?? "",
          role: u.personalization_role ?? "",
          tone: u.personalization_tone ?? "",
          length: u.personalization_length ?? "",
          language: u.personalization_language ?? "",
          about: u.personalization_about ?? "",
          style: u.personalization_style ?? "",
        };
        setForm(next);
        setInitial(next);
      })
      .catch(() => toast.error("Failed to load preferences"))
      .finally(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        personalization_nickname: form.nickname.trim() || null,
        personalization_role: form.role.trim() || null,
        personalization_tone: form.tone || null,
        personalization_length: form.length || null,
        personalization_language: form.language.trim() || null,
        personalization_about: form.about.trim() || null,
        personalization_style: form.style.trim() || null,
      };
      await updateMe(payload);
      setInitial(form);
      toast.success("Preferences saved");
    } catch {
      toast.error("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setForm(initial);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Personalize</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell the assistant about yourself and how you like responses. Applied on every new message.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>What should the AI call you?</Label>
          <Input
            value={form.nickname}
            onChange={(e) => update("nickname", e.target.value)}
            placeholder="e.g. Quang"
            maxLength={100}
          />
        </div>
        <div className="space-y-1.5">
          <Label>What do you do?</Label>
          <Input
            value={form.role}
            onChange={(e) => update("role", e.target.value)}
            placeholder="e.g. Software engineer"
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tone</Label>
          <Select
            value={form.tone || "default"}
            onValueChange={(v) => update("tone", !v || v === "default" ? "" : v)}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TONE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Response length</Label>
          <Select
            value={form.length || "default"}
            onValueChange={(v) => update("length", !v || v === "default" ? "" : v)}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LENGTH_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Preferred language</Label>
          <Input
            value={form.language}
            onChange={(e) => update("language", e.target.value)}
            placeholder="e.g. English, Tiếng Việt"
            maxLength={50}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>What should the AI know about you?</Label>
          <span className="text-[10px] text-muted-foreground">
            {form.about.length}/{ABOUT_MAX}
          </span>
        </div>
        <textarea
          value={form.about}
          onChange={(e) => update("about", e.target.value.slice(0, ABOUT_MAX))}
          rows={4}
          placeholder="Your background, projects, preferences…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>How should the AI respond?</Label>
          <span className="text-[10px] text-muted-foreground">
            {form.style.length}/{STYLE_MAX}
          </span>
        </div>
        <textarea
          value={form.style}
          onChange={(e) => update("style", e.target.value.slice(0, STYLE_MAX))}
          rows={4}
          placeholder="Formatting rules, reasoning style, what to avoid…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="outline" disabled={!dirty || saving} onClick={handleReset}>
          Reset
        </Button>
        <Button disabled={!dirty || saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
