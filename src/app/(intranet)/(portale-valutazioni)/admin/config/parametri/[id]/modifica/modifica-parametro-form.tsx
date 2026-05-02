"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { modificaParametro } from "../../../actions";
import Link from "next/link";
import { ColorPicker } from "@/components/ui/color-picker";

const schema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  descrizione: z.string().optional(),
  colore: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colore non valido (formato #RRGGBB)"),
  ordine: z.coerce.number().int().min(0),
});

type FormValues = z.infer<typeof schema>;


interface Parametro {
  id: string;
  nome: string;
  descrizione: string | null;
  colore: string;
  ordine: number;
}

export default function ModificaParametroForm({ parametro }: { parametro: Parametro }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: parametro.nome,
      descrizione: parametro.descrizione || "",
      colore: parametro.colore,
      ordine: parametro.ordine,
    },
  });

  const selectedColor = watch("colore");

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      Object.entries(values).forEach(([k, v]) => {
        if (v !== undefined && v !== null) fd.set(k, String(v));
      });
      const result = await modificaParametro(parametro.id, fd);
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

      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Nome <span className="text-danger">*</span>
        </label>
        <input {...register("nome")} type="text" className={inputClass} />
        {errors.nome && <p className="text-danger text-xs">{errors.nome.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">Descrizione</label>
        <textarea {...register("descrizione")} rows={2} className={`${inputClass} resize-none`} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <ColorPicker
            label="Colore"
            required
            value={selectedColor}
            onChange={(c) => setValue("colore", c, { shouldValidate: true })}
            error={errors.colore?.message}
          />
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Ordine <span className="text-danger">*</span>
          </label>
          <input {...register("ordine")} type="number" min={0} className={inputClass} />
          {errors.ordine && <p className="text-danger text-xs">{errors.ordine.message}</p>}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="bg-primary hover:bg-primary-dark text-white font-tenorite px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {isPending ? "Salvataggio…" : "Salva modifiche"}
        </button>
        <Link
          href="/admin/config"
          className="px-5 py-2.5 rounded-lg text-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors"
        >
          Annulla
        </Link>
      </div>
    </form>
  );
}
