"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { updateRuoloProfessionale, deleteRuoloProfessionale } from "../../actions";
import Link from "next/link";
import { Trash2 } from "lucide-react";

const schema = z.object({
  nome: z.string().min(1, "Nome obbligatorio"),
  descrizione: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  id: string;
  defaultNome: string;
  defaultDescrizione: string;
}

export default function ModificaProfiloForm({
  id,
  defaultNome,
  defaultDescrizione,
}: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nome: defaultNome, descrizione: defaultDescrizione },
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await updateRuoloProfessionale(id, {
        nome: values.nome,
        descrizione: values.descrizione || undefined,
      });
      if (!result.success) {
        setServerError(result.error);
        return;
      }
      router.push(`/admin/config/profili/${id}`);
      router.refresh();
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteRuoloProfessionale(id);
      if (!result.success) {
        setServerError(result.error);
        setShowDeleteConfirm(false);
      }
      // redirect avviene nella server action
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
          {isPending ? "Salvataggio…" : "Salva modifiche"}
        </button>
        <Link
          href={`/admin/config/profili/${id}`}
          className="px-5 py-2.5 rounded-lg text-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors"
        >
          Annulla
        </Link>
      </div>

      {/* Zona pericolosa */}
      <div className="pt-4 mt-4 border-t border-border">
        <h3 className="font-tenorite text-sm text-text mb-2">Zona pericolosa</h3>
        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-danger/30 text-danger hover:bg-danger/5 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Elimina profilo
          </button>
        ) : (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-4">
            <p className="text-sm text-danger mb-3">
              Eliminare questo profilo? Verranno eliminate anche tutte le
              mansioni associate. Questa azione è irreversibile.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="px-4 py-2 bg-danger hover:bg-danger/80 text-white text-sm font-tenorite rounded-lg transition-colors disabled:opacity-50"
              >
                {isPending ? "Eliminazione…" : "Sì, elimina"}
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 border border-border text-text-muted hover:text-text text-sm rounded-lg transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
