"use client";

import { useRouter, usePathname } from "next/navigation";
import { Plus, FileText, Zap, Anchor, Plug, PanelLeft, PanelLeftClose } from "lucide-react";
import { useAuth } from "@/components/auth-guard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarContent, ThemeToggle, UserMenu } from "@/components/sidebar-content";
import { createChat } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/documents", icon: FileText, label: "Documents", iconBg: "bg-primary/10", iconBgActive: "bg-primary/25", iconColor: "text-primary" },
  { href: "/skills", icon: Zap, label: "Skills", iconBg: "bg-amber-500/10", iconBgActive: "bg-amber-500/25", iconColor: "text-amber-500" },
  { href: "/hooks", icon: Anchor, label: "Hooks", iconBg: "bg-blue-500/10", iconBgActive: "bg-blue-500/25", iconColor: "text-blue-500" },
  { href: "/mcp", icon: Plug, label: "MCP", iconBg: "bg-purple-500/10", iconBgActive: "bg-purple-500/25", iconColor: "text-purple-500" },
];

export function Sidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { requireAuth } = useAuth();

  const handleNewChat = async () => {
    const authed = await requireAuth();
    if (!authed) return;
    try {
      const chat = await createChat();
      router.push(`/chat/${chat.id}`);
    } catch (e) {
      console.error("Failed to create chat:", e);
    }
  };

  // No toggle = always expanded (used in drawer)
  if (!onToggle) {
    return (
      <aside className="flex h-full w-64 flex-col border-r bg-muted/30">
        <SidebarContent />
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "group/sidebar flex h-full flex-col border-r bg-muted/30 transition-[width] duration-200 ease-out",
        collapsed ? "w-14 items-center" : "w-64"
      )}
    >
      {/* Header: logo / toggle */}
      <div className={cn("flex items-center py-3", collapsed ? "justify-center px-0" : "justify-between px-5")}>
        {collapsed ? (
          <Button variant="ghost" size="icon" onClick={onToggle} title="Expand sidebar">
            <img src="/small-logo.png" alt="FN" className="h-7 w-7 rounded-lg transition-opacity group-hover/sidebar:opacity-0" />
            <PanelLeft className="absolute h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover/sidebar:opacity-100" />
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <img src="/small-logo.png" alt="FN" className="h-7 w-7 rounded-lg" />
              <div className="overflow-hidden">
                <h1 className="truncate text-lg font-bold leading-tight tracking-tight">Friendly Neighbor</h1>
                <p className="truncate text-xs text-muted-foreground">Your AI assistant</p>
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onToggle} title="Collapse sidebar" className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/sidebar:opacity-100">
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Nav items */}
      <div className={cn("flex flex-col gap-1.5", collapsed ? "items-center px-0" : "px-3")}>
        {NAV_ITEMS.map(({ href, icon: Icon, label, iconBg, iconBgActive, iconColor }) => {
          const isActive = pathname.startsWith(href);
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              title={collapsed ? label : undefined}
              className={cn(
                "group flex items-center rounded-xl transition-all",
                collapsed
                  ? cn("h-9 w-9 justify-center", isActive ? iconBgActive : iconBg)
                  : cn(
                      "gap-3 border px-3 py-2.5 hover:shadow-md",
                      isActive
                        ? "border-primary/30 bg-primary/5 shadow-md"
                        : "border-border/60 bg-card shadow-sm hover:border-primary/30 hover:bg-accent"
                    )
              )}
            >
              <div className={cn(
                "flex shrink-0 items-center justify-center rounded-lg transition-colors",
                collapsed ? "" : "h-8 w-8",
                !collapsed && (isActive ? iconBgActive : iconBg)
              )}>
                <Icon className={cn("h-4 w-4", iconColor)} />
              </div>
              {!collapsed && (
                <span className={cn(
                  "truncate text-sm font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                )}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Separator className={cn("my-2", collapsed && "mx-auto w-8")} />

      {/* New Chat */}
      {collapsed ? (
        <div className="flex justify-center">
          <button
            onClick={handleNewChat}
            title="New Chat"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="px-3">
          <Button className="w-full justify-start gap-2" onClick={handleNewChat}>
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>
      )}

      {/* Chat list — only when expanded */}
      {!collapsed && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden animate-fade-in">
          <SidebarContent chatListOnly />
        </div>
      )}

      {collapsed && <div className="flex-1" />}

      {/* Footer */}
      <ThemeToggle vertical={collapsed} />
      <UserMenu collapsed={collapsed} />
    </aside>
  );
}
