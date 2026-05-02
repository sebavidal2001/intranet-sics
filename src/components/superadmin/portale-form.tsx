"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { creaPortale, modificaPortale } from "@/app/(superadmin)/superadmin/portali/actions";
import { ColorPicker } from "@/components/ui/color-picker";

const schema = z.object({
  nome: z.string().min(1, "Il nome è obbligatorio"),
  slug: z
    .string()
    .min(1, "Lo slug è obbligatorio")
    .regex(/^[a-z0-9-]+$/, "Solo lettere minuscole, numeri e trattini"),
  descrizione: z.string().optional(),
  icona: z.string().optional(),
  colore: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colore esadecimale non valido"),
  ordine: z.coerce.number().int().min(0, "Ordine deve essere >= 0"),
  is_attivo: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

interface PortaleData {
  id: string;
  nome: string;
  slug: string;
  descrizione: string | null;
  icona: string | null;
  colore: string | null;
  ordine: number;
  is_attivo: boolean;
}

interface Props {
  portale?: PortaleData;
}

function toSlug(nome: string): string {
  return nome
    .toLowerCase()
    .trim()
    .replace(/[àáâãäå]/g, "a")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõö]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function PortaleForm({ portale }: Props) {
  const isEdit = Boolean(portale?.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEdit);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: portale?.nome ?? "",
      slug: portale?.slug ?? "",
      descrizione: portale?.descrizione ?? "",
      icona: portale?.icona ?? "",
      colore: portale?.colore ?? "#00a1be",
      ordine: portale?.ordine ?? 0,
      is_attivo: portale?.is_attivo ?? true,
    },
  });

  const nomeValue = watch("nome");
  const coloreValue = watch("colore");

  // Auto-genera lo slug dal nome (solo se non è stato modificato manualmente)
  useEffect(() => {
    if (!slugManuallyEdited && nomeValue) {
      setValue("slug", toSlug(nomeValue), { shouldValidate: false });
    }
  }, [nomeValue, slugManuallyEdited, setValue]);

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      if (portale?.id) fd.set("id", portale.id);
      Object.entries(values).forEach(([k, v]) => {
        if (v !== undefined && v !== null) fd.set(k, String(v));
      });
      const action = isEdit ? modificaPortale : creaPortale;
      const result = await action(fd);
      if (!result.success) {
        setServerError(result.error);
      }
      // Se successo, la server action esegue redirect()
    });
  };

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
          placeholder="es. Valutazione del personale"
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]"
        />
        {errors.nome && (
          <p className="text-danger text-xs">{errors.nome.message}</p>
        )}
      </div>

      {/* Slug */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Slug <span className="text-danger">*</span>
        </label>
        <input
          {...register("slug")}
          type="text"
          placeholder="es. valutazione-personale"
          onChange={(e) => {
            setSlugManuallyEdited(true);
            register("slug").onChange(e);
          }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg font-mono placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]"
        />
        <p className="text-text-muted text-xs">
          Identificatore URL univoco — auto-generato dal nome, modificabile manualmente
        </p>
        {errors.slug && (
          <p className="text-danger text-xs">{errors.slug.message}</p>
        )}
      </div>

      {/* Descrizione */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">Descrizione</label>
        <textarea
          {...register("descrizione")}
          rows={3}
          placeholder="Breve descrizione del portale…"
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms] resize-none"
        />
      </div>

      {/* Icona / Colore */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">Icona Lucide</label>
          <input
            {...register("icona")}
            type="text"
            placeholder="es. ClipboardList"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg font-mono placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]"
          />
          <p className="text-text-muted text-xs">Nome componente icona Lucide</p>
        </div>

        <div>
          <ColorPicker
            label="Colore"
            value={coloreValue}
            onChange={(c) => setValue("colore", c, { shouldValidate: true })}
            error={errors.colore?.message}
          />
        </div>
      </div>

      {/* Ordine / is_attivo */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">Ordine</label>
          <input
            {...register("ordine")}
            type="number"
            min={0}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors duration-[120ms]"
          />
          {errors.ordine && (
            <p className="text-danger text-xs">{errors.ordine.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">Stato</label>
          <label className="flex items-center gap-2.5 mt-2.5 cursor-pointer select-none">
            <input
              {...register("is_attivo")}
              type="checkbox"
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <span className="text-sm text-text">Portale attivo</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Link
          href="/superadmin/portali"
          className="px-4 py-2.5 rounded-lg text-sm font-tenorite text-text-muted hover:text-text hover:bg-bg-page border border-border transition-colors"
        >
          Annulla
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2.5 rounded-lg text-sm font-tenorite bg-primary hover:bg-primary-dark text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending
            ? isEdit
              ? "Salvataggio in corso…"
              : "Creazione in corso…"
            : isEdit
            ? "Salva modifiche"
            : "Crea portale"}
        </button>
      </div>
    </form>
  );
}
