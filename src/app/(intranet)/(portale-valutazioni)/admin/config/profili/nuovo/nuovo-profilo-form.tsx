"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createRuoloProfessionale } from "../actions";
import Link from "next/link";

const schema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  descrizione: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NuovoProfiloForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nome: "", descrizione: "" },
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createRuoloProfessionale({
        nome: values.nome,
        descrizione: values.descrizione || undefined,
      });
      if (!result.success) setServerError(result.error);
    });
  };

  const inputClass =
    "w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {serverError && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          {serverError}
        </div>
      )}

      {/* Nome */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Nome <span className="text-danger">*</span>
        </label>
        <input
          {...register("nome")}
          type="text"
          placeholder="Es. Magazziniere, Back Office…"
          className={inputClass}
          autoFocus
        />
        {errors.nome && (
          <p className="text-danger text-xs">{errors.nome.message}</p>
        )}
      </div>

      {/* Descrizione */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Descrizione
        </label>
        <textarea
          {...register("descrizione")}
          rows={3}
          placeholder="Breve descrizione del profilo professionale…"
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="bg-primary hover:bg-primary-dark text-white font-tenorite px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {isPending ? "Salvataggio…" : "Crea profilo"}
        </button>
        <Link
          href="/admin/config/profili"
          className="px-5 py-2.5 rounded-lg text-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors"
        >
          Annulla
        </Link>
      </div>
    </form>
  );
}
