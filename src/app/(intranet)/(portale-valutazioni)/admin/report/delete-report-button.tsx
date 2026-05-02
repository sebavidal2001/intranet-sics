"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { eliminaReport } from "./actions";
import { Trash2 } from "lucide-react";

export default function DeleteReportButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    if (!confirm("Eliminare definitivamente questo report?")) return;
    startTransition(async () => {
      const result = await eliminaReport(id);
      if (!result.success) {
        alert(`Impossibile eliminare: ${result.error}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="p-2 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-danger/5 disabled:opacity-40"
      title="Elimina report"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
