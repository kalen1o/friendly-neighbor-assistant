import { MessageSquarePlus, FileText, HelpCircle, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="animate-fade-in-up">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">
          Welcome to Friendly Neighbor
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your AI assistant. Start a new chat or try one of these:
        </p>
      </div>

      <div className="flex animate-fade-in flex-wrap justify-center gap-2 [animation-delay:150ms]">
        <Chip icon={<HelpCircle className="h-3.5 w-3.5" />} label="Ask me anything" />
        <Chip icon={<FileText className="h-3.5 w-3.5" />} label="Upload a document" />
        <Chip icon={<MessageSquarePlus className="h-3.5 w-3.5" />} label="Summarize a topic" />
      </div>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground">
      {icon}
      {label}
    </span>
  );
}
