"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Sidebar } from "@/components/sidebar";

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close sheet on navigation
  const handleOpenChange = (value: boolean) => {
    setOpen(value);
  };

  // Close when pathname changes (user navigated)
  // useEffect would cause hydration issues, so we check on render
  // The Sheet will close when the user taps a link because Sidebar calls router.push

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8" />}>
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div onClick={() => setOpen(false)}>
          <Sidebar />
        </div>
      </SheetContent>
    </Sheet>
  );
}
