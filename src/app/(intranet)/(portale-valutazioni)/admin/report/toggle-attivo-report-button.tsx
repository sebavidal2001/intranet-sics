"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleAttivoReport } from "./actions";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  id: string;
  isAttivo: boolean;
}

export default function ToggleAttivoReportButton({ id, isAttivo }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggle = () => {
    startTransition(async () => {
      const result = await toggleAttivoReport(id, !isAttivo);
      if (!result.success) {
        alert(`Errore: ${result.error}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className="p-2 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/5 disabled:opacity-40"
      title={isAttivo ? "Disattiva report" : "Attiva report"}
    >
      {isAttivo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
    </button>
  );
}
