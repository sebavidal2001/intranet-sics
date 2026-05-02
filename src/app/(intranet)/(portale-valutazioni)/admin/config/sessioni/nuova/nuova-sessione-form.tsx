"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { creaSessione } from "../../actions";
import Link from "next/link";

const schema = z.object({
  anno: z.coerce.number().int().min(2020, "Anno non valido").max(2050, "Anno non valido"),
  scala_id: z.string().min(1, "Seleziona una scala"),
});

type FormValues = z.infer<typeof schema>;

interface Scala {
  id: string;
  nome: string;
  min: number;
  max: number;
}

interface Props {
  scale: Scala[];
}

export default function NuovaSessioneForm({ scale }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { anno: new Date().getFullYear() },
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("anno", String(values.anno));
      fd.set("scala_id", values.scala_id);
      const result = await creaSessione(fd);
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

      {/* Anno */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Anno <span className="text-danger">*</span>
        </label>
        <input
          {...register("anno")}
          type="number"
          min={2020}
          max={2050}
          className={inputClass}
        />
        {errors.anno && <p className="text-danger text-xs">{errors.anno.message}</p>}
      </div>

      {/* Scala */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Scala di valutazione <span className="text-danger">*</span>
        </label>
        <select {...register("scala_id")} className={inputClass}>
          <option value="">Seleziona una scala…</option>
          {scale.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome} ({s.min}–{s.max})
            </option>
          ))}
        </select>
        {errors.scala_id && <p className="text-danger text-xs">{errors.scala_id.message}</p>}
      </div>

      <div className="bg-primary-light border border-primary/20 rounded-lg px-4 py-3 text-sm text-text-muted">
        La sessione viene creata in stato <strong className="text-text">Chiusa</strong>.
        Potrai aggiungere domande e sbloccarla manualmente dalla pagina di configurazione.
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="bg-primary hover:bg-primary-dark text-white font-tenorite px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {isPending ? "Creazione…" : "Crea sessione"}
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
