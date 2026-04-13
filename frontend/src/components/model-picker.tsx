"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listModels, type ModelOut } from "@/lib/api";

const PROVIDER_ICONS: Record<string, string> = {
  openai: "🟢",
  anthropic: "🟠",
  openai_compatible: "🔵",
};

interface ModelPickerProps {
  selectedModelId: string | null;
  onSelect: (modelId: string | null) => void;
}

export function ModelPicker({ selectedModelId, onSelect }: ModelPickerProps) {
  const [models, setModels] = useState<ModelOut[]>([]);

  const fetchModels = useCallback(async () => {
    try {
      const data = await listModels();
      setModels(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchModels();
  }, [fetchModels]);

  const projectModels = models.filter((m) => m.builtin);
  const userModels = models.filter((m) => !m.builtin);
  const userDefault = userModels.find((m) => m.is_default);

  // Resolve which model is currently active
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const activeModel = selectedModel || projectModels[0] || null;

  let displayLabel = activeModel?.name || "Default";
  let displayIcon = activeModel ? (PROVIDER_ICONS[activeModel.provider] || "⚪") : "⚪";
  if (!selectedModelId && userDefault) {
    displayLabel = userDefault.name;
    displayIcon = PROVIDER_ICONS[userDefault.provider] || "⚪";
  }

  if (models.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] md:px-2 md:py-1 md:text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors">
        <span>{displayIcon}</span>
        <span className="max-w-[100px] truncate">{displayLabel}</span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="left" className="w-72 sm:w-56">
        {/* Project models */}
        {projectModels.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => onSelect(m.id)}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span>{PROVIDER_ICONS[m.provider] || "⚪"}</span>
              <div>
                <span className="text-sm">{m.name}</span>
              </div>
            </div>
            {(selectedModelId === m.id || (!selectedModelId && m === projectModels[0])) && (
              <Check className="h-3.5 w-3.5" />
            )}
          </DropdownMenuItem>
        ))}

        {/* User custom models */}
        {userModels.length > 0 && <DropdownMenuSeparator />}
        {userModels.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => onSelect(m.id)}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span>{PROVIDER_ICONS[m.provider] || "⚪"}</span>
              <div>
                <span className="text-sm">{m.name}</span>
                <p className="text-[10px] text-muted-foreground">{m.model_id}</p>
              </div>
            </div>
            {selectedModelId === m.id && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
