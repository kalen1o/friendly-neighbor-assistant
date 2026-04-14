"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings, ChevronUp, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth-guard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings-dialog";

export function UserMenu({ collapsed: menuCollapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const { user, loading, isAuthenticated, requireAuth, logout: handleLogout } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const wrapperClass = cn("border-t", menuCollapsed ? "flex justify-center py-2" : "min-h-[63px]");

  if (loading) {
    return (
      <div className={wrapperClass}>
        {menuCollapsed ? (
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
        ) : (
          <div className="flex items-center gap-2.5 p-3">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-28 animate-pulse rounded bg-muted" />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={wrapperClass}>
        {menuCollapsed ? (
          <button
            onClick={() => requireAuth()}
            title="Sign in"
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary"
          >
            ?
          </button>
        ) : (
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2.5 px-3 py-3"
            onClick={() => requireAuth()}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 text-xs text-muted-foreground">
              ?
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Sign in</p>
              <p className="text-[11px] text-muted-foreground/50">to sync your chats</p>
            </div>
          </Button>
        )}
      </div>
    );
  }

  const initial = (user?.name?.[0] || user?.email?.[0] || "?").toUpperCase();

  return (
    <div className={wrapperClass}>
      <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmLogout(false); }}>
        <DropdownMenuTrigger className={cn(
          "flex cursor-pointer items-center border-0 bg-transparent transition-colors hover:bg-accent",
          menuCollapsed
            ? "h-8 w-8 justify-center rounded-full"
            : "w-full gap-2.5 p-3 text-left"
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {initial}
          </div>
          {!menuCollapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
              </div>
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className={menuCollapsed ? "w-48" : "w-[var(--anchor-width)]"}>
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
          {user?.role === "admin" && (
            <DropdownMenuItem onClick={() => router.push("/admin")}>
              <Shield className="mr-2 h-4 w-4" />
              Admin
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {!confirmLogout ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                setConfirmLogout(true);
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          ) : (
            <div className="flex flex-col gap-1 px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Sign out?</p>
              <div className="flex gap-1">
                <button
                  className="flex-1 rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    handleLogout();
                    router.push("/");
                  }}
                >
                  Yes
                </button>
                <button
                  className="flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                  onClick={() => setConfirmLogout(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onChatsDeleted={() => {
          setSettingsOpen(false);
          window.dispatchEvent(new Event("chats-cleared"));
        }}
      />
    </div>
  );
}
