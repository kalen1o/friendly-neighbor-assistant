import { AdminGuard } from "@/components/admin-guard";
import { AdminNav } from "@/components/admin-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        <div className="mx-auto max-w-5xl px-4 py-8">
          <AdminNav />
          {children}
        </div>
      </div>
    </AdminGuard>
  );
}
