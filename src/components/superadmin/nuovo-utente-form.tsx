"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useTransition } from "react";
import Link from "next/link";
import { creaUtente } from "@/app/(superadmin)/superadmin/utenti/actions";

const schema = z.object({
  nome: z.string().min(1, "Il nome è obbligatorio"),
  cognome: z.string().min(1, "Il cognome è obbligatorio"),
  username: z
    .string()
    .min(3, "Username minimo 3 caratteri")
    .regex(/^[a-zA-Z0-9._-]+$/, "Solo lettere, numeri, . _ -"),
  password: z.string().min(8, "Password minimo 8 caratteri"),
  ruolo: z.string().min(1, "Il ruolo è obbligatorio"),
  reparto: z.string().optional(),
  responsabile_id: z.string().optional(),
  stato: z.enum(["attivo", "inattivo"]),
  data_assunzione: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface RuoloOption {
  value: string;
  label: string;
}

interface RepartoOption {
  id: string;
  nome: string;
}

interface ResponsabileOption {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
}

interface Props {
  responsabili: ResponsabileOption[];
  ruoliConfig: RuoloOption[];
  reparti: RepartoOption[];
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-150";

export function NuovoUtenteForm({ responsabili, ruoliConfig, reparti }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ruolo: "collaboratore",
      stato: "attivo",
    },
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    startTransition(async () => {
      const fd = new FormData();
      Object.entries(values).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") fd.set(k, String(v));
      });
      const result = await creaUtente(fd);
      if (!result.success) setServerError(result.error);
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
            className={inputClass}
          />
          {errors.nome && <p className="text-danger text-xs">{errors.nome.message}</p>}
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Cognome <span className="text-danger">*</span>
          </label>
          <input
            {...register("cognome")}
            type="text"
            placeholder="Rossi"
            className={inputClass}
          />
          {errors.cognome && <p className="text-danger text-xs">{errors.cognome.message}</p>}
        </div>
      </div>

      {/* Username */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Username <span className="text-danger">*</span>
        </label>
        <div className="flex items-center border border-border rounded-lg overflow-hidden focus-within:border-primary transition-colors duration-150">
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
        {errors.username && <p className="text-danger text-xs">{errors.username.message}</p>}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">
          Password <span className="text-danger">*</span>
        </label>
        <input
          {...register("password")}
          type="password"
          placeholder="Minimo 8 caratteri"
          className={inputClass}
        />
        {errors.password && <p className="text-danger text-xs">{errors.password.message}</p>}
      </div>

      {/* Ruolo / Stato */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Ruolo <span className="text-danger">*</span>
          </label>
          <select {...register("ruolo")} className={inputClass}>
            {ruoliConfig.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {errors.ruolo && <p className="text-danger text-xs">{errors.ruolo.message}</p>}
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">
            Stato <span className="text-danger">*</span>
          </label>
          <select {...register("stato")} className={inputClass}>
            <option value="attivo">Attivo</option>
            <option value="inattivo">Inattivo</option>
          </select>
        </div>
      </div>

      {/* Reparto / Data assunzione */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">Reparto</label>
          <select {...register("reparto")} className={inputClass}>
            <option value="">— Nessun reparto —</option>
            {reparti.map((r) => (
              <option key={r.id} value={r.nome}>
                {r.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block font-tenorite text-sm text-text">Data assunzione</label>
          <input
            {...register("data_assunzione")}
            type="date"
            className={inputClass}
          />
        </div>
      </div>

      {/* Responsabile */}
      <div className="space-y-1.5">
        <label className="block font-tenorite text-sm text-text">Responsabile</label>
        <select {...register("responsabile_id")} className={inputClass}>
          <option value="">— Nessun responsabile —</option>
          {responsabili.map((r) => (
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
          {isPending ? "Creazione in corso…" : "Crea utente"}
        </button>
      </div>
    </form>
  );
}
