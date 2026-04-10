"use client";

import { useState } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
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
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <title>Friendly Neighbor — AI Assistant</title>
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
              <main className="flex flex-1 flex-col overflow-hidden">
                {/* Mobile header with burger */}
                <div className="flex items-center border-b px-3 py-2 md:hidden">
                  <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                    <SheetTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8" />}>
                      <Menu className="h-5 w-5" />
                    </SheetTrigger>
                    <SheetContent side="left" className="flex w-72 flex-col p-0">
                      <SheetTitle className="sr-only">Navigation</SheetTitle>
                      <div className="flex flex-1 flex-col overflow-hidden" onClick={() => setMobileOpen(false)}>
                        <SidebarContent />
                      </div>
                    </SheetContent>
                  </Sheet>
                  <img src="/small-logo.png" alt="FN" className="ml-2 h-5 w-5 rounded" />
                  <h1 className="ml-1.5 text-sm font-semibold">Friendly Neighbor</h1>
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
