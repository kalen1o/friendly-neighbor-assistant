"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { SidebarContent } from "@/components/sidebar-content";
import { ThemeProvider } from "@/components/theme-provider";
import { DottedSurface } from "@/components/ui/dotted-surface";
import { Toaster } from "sonner";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const collapsedBeforeArtifactRef = useRef(false);

  // Auto-collapse sidebar when artifact panel opens, restore when it closes
  useEffect(() => {
    function handleArtifactPanel(e: Event) {
      const open = (e as CustomEvent).detail?.open;
      if (open) {
        collapsedBeforeArtifactRef.current = desktopCollapsed;
        setDesktopCollapsed(true);
      } else {
        setDesktopCollapsed(collapsedBeforeArtifactRef.current);
      }
    }
    window.addEventListener("artifact-panel", handleArtifactPanel);
    return () => window.removeEventListener("artifact-panel", handleArtifactPanel);
  }, [desktopCollapsed]);

  // Sandbox route: bare layout, no chrome
  if (pathname === "/sandbox") {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className} style={{ margin: 0, overflow: "hidden" }}>
          {children}
        </body>
      </html>
    );
  }

  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <title>Friendly Neighbor — AI Assistant</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Toaster position="top-right" richColors closeButton />
          <DottedSurface />
          <AuthGuard>
            <div className="flex h-screen">
              {/* Desktop: togglable sidebar */}
              <div className="hidden md:flex">
                <Sidebar
                  collapsed={desktopCollapsed}
                  onToggle={() => setDesktopCollapsed(!desktopCollapsed)}
                />
              </div>
              <main
                className="flex flex-1 flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]"
                onTouchStart={(e) => {
                  touchStartX.current = e.touches[0].clientX;
                  touchStartY.current = e.touches[0].clientY;
                }}
                onTouchEnd={(e) => {
                  const dx = e.changedTouches[0].clientX - touchStartX.current;
                  const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
                  // Swipe right from left edge to open sidebar
                  if (touchStartX.current < 30 && dx > 50 && dy < 100) {
                    setMobileOpen(true);
                  }
                }}
              >
                {/* Mobile header with burger */}
                <div className="flex items-center border-b px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
                  <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                    <SheetTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8" />}>
                      <Menu className="h-5 w-5" />
                    </SheetTrigger>
                    <SheetContent side="left" className="flex w-72 flex-col p-0">
                      <SheetTitle className="sr-only">Navigation</SheetTitle>
                      <div className="flex h-full flex-col overflow-y-auto" onClick={() => setMobileOpen(false)}>
                        <SidebarContent />
                      </div>
                    </SheetContent>
                  </Sheet>
                  <Link href="/" className="ml-2 flex items-center gap-1.5">
                    <img src="/small-logo.png" alt="FN" className="h-5 w-5 rounded" />
                    <span className="text-sm font-semibold">Friendly Neighbor</span>
                  </Link>
                  <div className="flex-1" />
                  {/* Mobile action buttons slot — filled by chat page via portal */}
                  <div id="mobile-header-actions" className="flex items-center gap-0.5" />
                </div>
                {children}
              </main>
            </div>
          </AuthGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}
