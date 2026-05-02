"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { eliminaParametro } from "./actions";
import { Trash2 } from "lucide-react";

export default function DeleteParametroButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    if (!confirm("Eliminare definitivamente questo parametro?")) return;
    startTransition(async () => {
      const result = await eliminaParametro(id);
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
      className="p-1.5 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-danger/5 disabled:opacity-40"
      title="Elimina parametro"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}
