"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useTransition } from "react";
import Link from "next/link";
import { modificaUtente } from "@/app/(superadmin)/superadmin/utenti/actions";

const schema = z.object({
  nome: z.string().min(1, "Il nome è obbligatorio"),
  cognome: z.string().min(1, "Il cognome è obbligatorio"),
  username: z
    .string()
    .min(3, "Username minimo 3 caratteri")
    .regex(/^[a-zA-Z0-9._-]+$/, "Solo lettere, numeri, . _ -"),
  password: z
    .string()
    .optional()
    .refine((val) => !val || val.length >= 8, {
      message: "Password minimo 8 caratteri",
    }),
  ruolo: z.string().min(1, "Il ruolo è obbligatorio"),
  stato: z.enum(["attivo", "inattivo"]),
  reparto: z.string().optional(),
  responsabile_id: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface UtenteDettaglio {
  id: string;
  nome: string;
  cognome: string;
  username: string | null;
  ruolo: string;
  stato: "attivo" | "inattivo" | null;
  reparto: string | null;
  responsabile_id: string | null;
}

interface ResponsabileOption {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
}

interface RuoloOption {
  value: string;
  label: string;
}

interface Props {
  utente: UtenteDettaglio;
  responsabili: ResponsabileOption[];
  ruoliConfig?: RuoloOption[];
}

const RUOLI_DEFAULT: RuoloOption[] = [
  { value: "superadmin", label: "Superadmin" },
  { value: "amministratore", label: "Amministratore" },
  { value: "responsabile", label: "Responsabile" },
  { value: "responsabile_intermedio", label: "Responsabile Intermedio" },
  { value: "collaboratore", label: "Collaboratore" },
];

export function ModificaUtenteForm({ utente, responsabili, ruoliConfig }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ruoli = ruoliConfig && ruoliConfig.length > 0 ? ruoliConfig : RUOLI_DEFAULT;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: utente.nome,
      cognome: utente.cognome,
      username: utente.username ?? "",
      password: "",
      ruolo: utente.ruolo,
      stato: utente.stato ?? "attivo",
      reparto: utente.reparto ?? "",
      responsabile_id: utente.responsabile_id ?? "",
    },
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", utente.id);
      Object.entries(values).forEach(([k, v]) => {
        if (v !== undefined && v !== null) fd.set(k, String(v));
      });
      const result = await modificaUtente(fd);
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

      {/* Nome / Cognome */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Nome <span className="text-danger">*</span>
          </label>
          <input
            {...register("nome")}
            type="text"
            placeholder="Mario"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]"
          />
          {errors.nome && (
            <p className="text-danger text-xs">{errors.nome.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Cognome <span className="text-danger">*</span>
          </label>
          <input
            {...register("cognome")}
            type="text"
            placeholder="Rossi"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]"
          />
          {errors.cognome && (
            <p className="text-danger text-xs">{errors.cognome.message}</p>
          )}
        </div>
      </div>

      {/* Username */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Username <span className="text-danger">*</span>
        </label>
        <div className="flex items-center border border-border rounded-lg overflow-hidden focus-within:border-primary transition-colors duration-[120ms]">
          <input
            {...register("username")}
            type="text"
            placeholder="mario.rossi"
            className="flex-1 px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none"
          />
          <span className="px-3 py-2.5 text-sm text-text-muted bg-bg-page border-l border-border select-none">
            @sics.interno
          </span>
        </div>
        {errors.username && (
          <p className="text-danger text-xs">{errors.username.message}</p>
        )}
      </div>

      {/* Password (opzionale) */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Nuova password{" "}
          <span className="text-text-muted font-normal">(lascia vuoto per non modificare)</span>
        </label>
        <input
          {...register("password")}
          type="password"
          placeholder="Minimo 8 caratteri"
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]"
        />
        {errors.password && (
          <p className="text-danger text-xs">{errors.password.message}</p>
        )}
      </div>

      {/* Ruolo / Reparto */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Ruolo <span className="text-danger">*</span>
          </label>
          <select
            {...register("ruolo")}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors duration-[120ms]"
          >
            {ruoli.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {errors.ruolo && (
            <p className="text-danger text-xs">{errors.ruolo.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">Reparto</label>
          <input
            {...register("reparto")}
            type="text"
            placeholder="es. Amministrazione"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]"
          />
        </div>
      </div>

      {/* Stato */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Stato <span className="text-danger">*</span>
        </label>
        <select
          {...register("stato")}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors duration-[120ms]"
        >
          <option value="attivo">Attivo</option>
          <option value="inattivo">Inattivo</option>
        </select>
        {errors.stato && (
          <p className="text-danger text-xs">{errors.stato.message}</p>
        )}
      </div>

      {/* Responsabile */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">Responsabile</label>
        <select
          {...register("responsabile_id")}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors duration-[120ms]"
        >
          <option value="">— Nessun responsabile —</option>
          {responsabili
            .filter((r) => r.id !== utente.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.cognome} {r.nome} ({r.ruolo})
              </option>
            ))}
        </select>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Link
          href="/superadmin/utenti"
          className="px-4 py-2.5 rounded-lg text-sm font-tenorite text-text-muted hover:text-text hover:bg-bg-page border border-border transition-colors"
        >
          Annulla
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2.5 rounded-lg text-sm font-tenorite bg-primary hover:bg-primary-dark text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Salvataggio in corso…" : "Salva modifiche"}
        </button>
      </div>
    </form>
  );
}
