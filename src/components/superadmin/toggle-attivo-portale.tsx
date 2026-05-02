"use client";

import { useTransition } from "react";
import { toggleAttivoPortale } from "@/app/(superadmin)/superadmin/portali/actions";

interface Props {
  id: string;
  isAttivo: boolean;
}

export function ToggleAttivoPortale({ id, isAttivo }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleChange = () => {
    startTransition(async () => {
      await toggleAttivoPortale(id, !isAttivo);
    });
  };

  return (
    <button
      type="button"
      onClick={handleChange}
      disabled={isPending}
      aria-label={isAttivo ? "Disattiva portale" : "Attiva portale"}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
        isAttivo ? "bg-primary" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150 ${
          isAttivo ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
