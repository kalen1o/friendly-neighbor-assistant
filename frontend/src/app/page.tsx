import { MessageSquarePlus } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <MessageSquarePlus className="h-12 w-12" />
      <h2 className="text-xl font-medium">Welcome to Friendly Neighbor</h2>
      <p className="text-sm">
        Create a new chat from the sidebar to get started.
      </p>
    </div>
  );
}
