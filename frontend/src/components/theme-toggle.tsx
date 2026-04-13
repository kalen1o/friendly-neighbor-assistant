"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ vertical = false }: { vertical?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard hydration guard
  useEffect(() => setMounted(true), []);
  const themes = [
    { value: "light", icon: Sun, title: "Light" },
    { value: "dark", icon: Moon, title: "Dark" },
    { value: "system", icon: Monitor, title: "System" },
  ];

  return (
    <div className={cn(
      "flex items-center justify-center gap-1 border-t px-3 py-2",
      vertical && "flex-col px-0"
    )}>
      {themes.map((t) => {
        const isActive = mounted && theme === t.value;
        return (
          <button
            key={t.value}
            onClick={() => setTheme(t.value)}
            title={t.title}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent"
            )}
          >
            <t.icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
