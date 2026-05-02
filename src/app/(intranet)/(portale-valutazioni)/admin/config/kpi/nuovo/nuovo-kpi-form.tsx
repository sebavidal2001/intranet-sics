"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import type { ActionResult } from "@/lib/types";

const schema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  parametro_id: z.string().optional(),
  operatore: z.enum([">", "<", ">=", "<=", "="]),
  soglia: z.coerce.number(),
  anno: z.coerce.number().int().min(2020).max(2050).optional().or(z.literal(0)),
});

type FormValues = z.infer<typeof schema>;

interface Parametro { id: string; nome: string }

interface Props {
  parametri: Parametro[];
  action: (formData: FormData) => Promise<ActionResult>;
  defaultValues?: Partial<FormValues>;
}

export default function NuovoKpiForm({ parametri, action, defaultValues }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: defaultValues?.nome ?? "",
      parametro_id: defaultValues?.parametro_id ?? "",
      operatore: defaultValues?.operatore ?? ">",
      soglia: defaultValues?.soglia ?? 3,
      anno: defaultValues?.anno ?? (0 as unknown as undefined),
    },
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("nome", values.nome);
      if (values.parametro_id) fd.set("parametro_id", values.parametro_id);
      fd.set("operatore", values.operatore);
      fd.set("soglia", String(values.soglia));
      if (values.anno) fd.set("anno", String(values.anno));
      const result = await action(fd);
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
        <input {...register("nome")} type="text" placeholder="es. Media responsabile ≥ 3" className={inputClass} />
        {errors.nome && <p className="text-danger text-xs">{errors.nome.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">Parametro radar</label>
        <select {...register("parametro_id")} className={inputClass}>
          <option value="">Tutti i parametri (media globale)</option>
          {parametri.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
        <p className="text-text-muted text-xs">Lascia vuoto per applicare il KPI alla media complessiva.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Operatore <span className="text-danger">*</span>
          </label>
          <select {...register("operatore")} className={inputClass}>
            <option value=">">{">"} maggiore di</option>
            <option value=">=">{">="} maggiore o uguale</option>
            <option value="=">{"="} uguale a</option>
            <option value="<=">{"<="} minore o uguale</option>
            <option value="<">{"<"} minore di</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Soglia <span className="text-danger">*</span>
          </label>
          <input {...register("soglia")} type="number" step="0.1" min="0" max="5" className={inputClass} />
          {errors.soglia && <p className="text-danger text-xs">{errors.soglia.message}</p>}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">Anno</label>
        <input
          {...register("anno")}
          type="number"
          min="2020"
          max="2050"
          placeholder="Lascia vuoto per tutti gli anni"
          className={inputClass}
        />
        <p className="text-text-muted text-xs">Opzionale — se specificato il KPI si applica solo a quell&apos;anno.</p>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="bg-primary hover:bg-primary-dark text-white font-tenorite px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {isPending ? "Salvataggio…" : "Salva KPI"}
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
