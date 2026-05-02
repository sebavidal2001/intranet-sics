"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { creaScala } from "../../actions";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

const schema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  min: z.coerce.number().int().min(1, "Min deve essere >= 1"),
  max: z.coerce.number().int().max(100, "Max deve essere <= 100"),
});

type FormValues = z.infer<typeof schema>;

export default function NuovaScalaPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { min: 1, max: 5 },
  });

  const min = useWatch({ control, name: "min" }) || 1;
  const max = useWatch({ control, name: "max" }) || 5;

  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const minN = Number(min);
    const maxN = Number(max);
    if (!isNaN(minN) && !isNaN(maxN) && minN < maxN) {
      const next: Record<string, string> = {};
      for (let i = minN; i <= maxN; i++) {
        next[String(i)] = labels[String(i)] || "";
      }
      setLabels(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("nome", values.nome);
      fd.set("min", String(values.min));
      fd.set("max", String(values.max));
      Object.entries(labels).forEach(([k, v]) => fd.set(`label_${k}`, v));
      const result = await creaScala(fd);
      if (!result.success) setServerError(result.error);
    });
  };

  const inputClass =
    "w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors";

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Scale" },
        { label: "Nuova scala" },
      ]} />
      <div className="mb-6">
        <h1 className="font-tenorite text-2xl text-text">Nuova Scala di Valutazione</h1>
        <p className="text-text-muted text-sm mt-1">
          Definisci il range numerico e le etichette per ogni livello.
        </p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
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
              placeholder="Es. Scala 1-5"
              className={inputClass}
            />
            {errors.nome && <p className="text-danger text-xs">{errors.nome.message}</p>}
          </div>

          {/* Min / Max */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block font-tenorite text-sm text-text">
                Valore minimo <span className="text-danger">*</span>
              </label>
              <input
                {...register("min")}
                type="number"
                min={1}
                className={inputClass}
              />
              {errors.min && <p className="text-danger text-xs">{errors.min.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block font-tenorite text-sm text-text">
                Valore massimo <span className="text-danger">*</span>
              </label>
              <input
                {...register("max")}
                type="number"
                max={100}
                className={inputClass}
              />
              {errors.max && <p className="text-danger text-xs">{errors.max.message}</p>}
            </div>
          </div>

          {/* Labels */}
          {Object.keys(labels).length > 0 && (
            <div className="space-y-2">
              <label className="block font-tenorite text-sm text-text">
                Etichette per livello
                <span className="font-normal text-text-muted ml-1">(opzionale)</span>
              </label>
              <div className="space-y-2">
                {Object.keys(labels).map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-8 text-right font-tenorite text-sm text-primary shrink-0">
                      {k}
                    </span>
                    <input
                      type="text"
                      value={labels[k]}
                      onChange={(e) =>
                        setLabels((prev) => ({ ...prev, [k]: e.target.value }))
                      }
                      placeholder={`Etichetta per ${k}`}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isPending}
              className="bg-primary hover:bg-primary-dark text-white font-tenorite px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {isPending ? "Salvataggio…" : "Crea scala"}
            </button>
            <Link
              href="/admin/config"
              className="px-5 py-2.5 rounded-lg text-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors"
            >
              Annulla
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
