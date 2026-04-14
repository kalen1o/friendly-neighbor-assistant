"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Star, StarOff, TestTube, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  listModels,
  createModel,
  updateModel,
  deleteModel,
  testModel,
  getMe,
  updateMe,
  type ModelOut,
} from "@/lib/api";

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai_compatible", label: "OpenAI-Compatible" },
];

const PROVIDER_ICONS: Record<string, string> = {
  openai: "🟢",
  anthropic: "🟠",
  openai_compatible: "🔵",
};

export function ModelSettings() {
  const [models, setModels] = useState<ModelOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [preferredModel, setPreferredModel] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("openai");
  const [formModelId, setFormModelId] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");

  const fetchModels = useCallback(async () => {
    try {
      const data = await listModels();
      setModels(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getMe().then((u) => setPreferredModel(u.preferred_model)).catch(() => {});
  }, []);

  const handlePreferredChange = async (modelId: string | null) => {
    if (!modelId) return;
    const value = modelId === "__default__" ? null : modelId;
    setPreferredModel(value);
    try {
      await updateMe({ preferred_model: value });
      toast.success("Default model updated");
    } catch {
      toast.error("Failed to update default model");
    }
  };

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const resetForm = () => {
    setFormName("");
    setFormProvider("openai");
    setFormModelId("");
    setFormApiKey("");
    setFormBaseUrl("");
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formModelId.trim() || !formApiKey.trim()) {
      toast.error("Name, model ID, and API key are required");
      return;
    }
    setSaving(true);
    try {
      await createModel({
        name: formName.trim(),
        provider: formProvider,
        model_id: formModelId.trim(),
        api_key: formApiKey,
        base_url: formProvider === "openai_compatible" ? formBaseUrl.trim() || undefined : undefined,
      });
      toast.success("Model added successfully");
      resetForm();
      fetchModels();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteModel(id);
      toast.success("Model deleted");
      fetchModels();
    } catch {
      toast.error("Failed to delete model");
    }
  };

  const handleSetDefault = async (id: string, current: boolean) => {
    try {
      await updateModel(id, { is_default: !current });
      fetchModels();
    } catch {
      toast.error("Failed to update default");
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await testModel(id);
      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error(`Connection failed: ${result.message}`);
      }
    } catch {
      toast.error("Test failed");
    } finally {
      setTesting(null);
    }
  };

  const projectDefault = models.find((m) => m.builtin);
  const userModels = models.filter((m) => !m.builtin);

  return (
    <div>
      <h2 className="text-lg font-semibold">Models</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Add your own LLM models with API keys.
      </p>

      <div className="mb-4">
        <Label className="text-xs">Default model for new chats</Label>
        <Select
          value={preferredModel || "__default__"}
          onValueChange={handlePreferredChange}
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.builtin ? `${m.provider}:${m.model_id}` : `user:${m.id}`}>
                {PROVIDER_ICONS[m.provider] || "⚪"} {m.model_id}{m.builtin && m === projectDefault ? " (project default)" : ""}{!m.builtin ? ` (${m.name})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {userModels.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span>{PROVIDER_ICONS[m.provider] || "⚪"}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {m.is_default && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{m.model_id}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => handleSetDefault(m.id, m.is_default)}
                  title={m.is_default ? "Remove default" : "Set as default"}>
                  {m.is_default ? <Star className="h-3.5 w-3.5 fill-primary text-primary" /> : <StarOff className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => handleTest(m.id)} disabled={testing === m.id} title="Test connection">
                  {testing === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive"
                  onClick={() => handleDelete(m.id)} title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="mt-4 space-y-3 rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Display Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="My GPT-4o" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Provider</Label>
              <Select value={formProvider} onValueChange={(v) => { if (v) setFormProvider(v); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (<SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Model ID</Label>
            <Input value={formModelId} onChange={(e) => setFormModelId(e.target.value)}
              placeholder={formProvider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o"} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">API Key</Label>
            <Input type="password" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="sk-..." className="mt-1" />
          </div>
          {formProvider === "openai_compatible" && (
            <div>
              <Label className="text-xs">Base URL</Label>
              <Input value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="mt-1" />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? (<><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Testing & Saving...</>) : "Add Model"}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => setShowForm(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Add Model
        </Button>
      )}
    </div>
  );
}
