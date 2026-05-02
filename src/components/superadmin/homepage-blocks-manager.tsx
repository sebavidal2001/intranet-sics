"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Pencil, X, Check, Newspaper, Link2 } from "lucide-react";
import {
  creaBlock,
  toggleAttivoBlock,
  eliminaBlock,
  aggiornaBlock,
} from "@/app/(superadmin)/superadmin/homepage/actions";

interface HomepageBlock {
  id: string;
  tipo: "news" | "link";
  titolo: string;
  testo: string | null;
  url: string | null;
  icona: string | null;
  ordine: number;
  is_attivo: boolean;
}

interface Props {
  newsBlocks: HomepageBlock[];
  linkBlocks: HomepageBlock[];
}

/* ------------------------------------------------------------------ */
/* Toggle attivo / disattivo                                           */
/* ------------------------------------------------------------------ */
function ToggleBlock({
  id,
  isAttivo,
}: {
  id: string;
  isAttivo: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await toggleAttivoBlock(id, !isAttivo);
        })
      }
      aria-label={isAttivo ? "Disattiva" : "Attiva"}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-150 focus:outline-none disabled:opacity-50 ${
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

/* ------------------------------------------------------------------ */
/* Form inline aggiungi / modifica                                     */
/* ------------------------------------------------------------------ */
interface BlockFormProps {
  tipo: "news" | "link";
  initialValues?: Omit<HomepageBlock, "tipo" | "is_attivo">;
  onClose: () => void;
}

function BlockForm({ tipo, initialValues, onClose }: BlockFormProps) {
  const isEdit = !!initialValues;
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("tipo", tipo);

    startTransition(async () => {
      const result = isEdit
        ? await aggiornaBlock(initialValues!.id, fd)
        : await creaBlock(fd);

      if (!result.success) {
        setError(result.error);
      } else {
        onClose();
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 bg-bg-page border border-border rounded-xl p-4 space-y-3"
    >
      {error && (
        <p className="text-danger text-xs bg-danger/10 rounded px-3 py-2">{error}</p>
      )}

      <div className="space-y-1">
        <label className="block font-tenorite text-xs text-text-muted">
          Titolo <span className="text-danger">*</span>
        </label>
        <input
          name="titolo"
          type="text"
          required
          defaultValue={initialValues?.titolo ?? ""}
          placeholder={tipo === "news" ? "es. Aggiornamento policy" : "es. Portale valutazioni"}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      {tipo === "news" && (
        <div className="space-y-1">
          <label className="block font-tenorite text-xs text-text-muted">Testo</label>
          <textarea
            name="testo"
            rows={3}
            defaultValue={initialValues?.testo ?? ""}
            placeholder="Descrizione della news…"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors resize-none"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {tipo === "link" && (
          <div className="space-y-1 col-span-2">
            <label className="block font-tenorite text-xs text-text-muted">
              URL <span className="text-danger">*</span>
            </label>
            <input
              name="url"
              type="url"
              required={tipo === "link"}
              defaultValue={initialValues?.url ?? ""}
              placeholder="https://…"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        )}

        {tipo === "news" && (
          <div className="space-y-1">
            <label className="block font-tenorite text-xs text-text-muted">URL (opzionale)</label>
            <input
              name="url"
              type="url"
              defaultValue={initialValues?.url ?? ""}
              placeholder="https://…"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="block font-tenorite text-xs text-text-muted">Icona (Lucide)</label>
          <input
            name="icona"
            type="text"
            defaultValue={initialValues?.icona ?? ""}
            placeholder="es. FileText"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="space-y-1">
          <label className="block font-tenorite text-xs text-text-muted">Ordine</label>
          <input
            name="ordine"
            type="number"
            defaultValue={initialValues?.ordine ?? 0}
            min={0}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-tenorite text-text-muted border border-border hover:bg-bg-page transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Annulla
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-tenorite bg-primary hover:bg-primary-dark text-white transition-colors disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          {isPending ? "Salvataggio…" : isEdit ? "Salva" : "Aggiungi"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Riga singolo block                                                  */
/* ------------------------------------------------------------------ */
function BlockRow({ block }: { block: HomepageBlock }) {
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleElimina = () => {
    startTransition(async () => {
      await eliminaBlock(block.id);
    });
  };

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-bg-page transition-colors">
        <div className="flex-1 min-w-0">
          <p className="font-tenorite text-sm text-text truncate">{block.titolo}</p>
          {block.testo && (
            <p className="text-xs text-text-muted truncate mt-0.5">{block.testo}</p>
          )}
          {block.url && (
            <p className="text-xs text-primary truncate mt-0.5">{block.url}</p>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-text-muted shrink-0">
          <span className="font-mono">#{block.ordine}</span>
        </div>

        <ToggleBlock id={block.id} isAttivo={block.is_attivo} />

        <button
          type="button"
          onClick={() => setEditOpen((v) => !v)}
          className="text-text-muted hover:text-primary transition-colors"
          aria-label="Modifica"
        >
          <Pencil className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleElimina}
          disabled={isPending}
          className="text-danger hover:text-danger/70 transition-colors disabled:opacity-50"
          aria-label="Elimina"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {editOpen && (
        <div className="px-5 pb-4">
          <BlockForm
            tipo={block.tipo}
            initialValues={{
              id: block.id,
              titolo: block.titolo,
              testo: block.testo,
              url: block.url,
              icona: block.icona,
              ordine: block.ordine,
            }}
            onClose={() => setEditOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sezione (news / link)                                              */
/* ------------------------------------------------------------------ */
interface SectionProps {
  tipo: "news" | "link";
  blocks: HomepageBlock[];
  icon: React.ReactNode;
  title: string;
  description: string;
}

function BlocksSection({ tipo, blocks, icon, title, description }: SectionProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section className="bg-bg rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-bg-page flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center text-primary shrink-0">
            {icon}
          </div>
          <div>
            <h2 className="font-tenorite text-base text-text">{title}</h2>
            <p className="text-xs text-text-muted mt-0.5">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-tenorite text-primary hover:text-primary-dark transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          Aggiungi
        </button>
      </div>

      {addOpen && (
        <div className="px-5 py-4 border-b border-border">
          <BlockForm tipo={tipo} onClose={() => setAddOpen(false)} />
        </div>
      )}

      {blocks.length === 0 && !addOpen && (
        <div className="px-5 py-10 text-center text-text-muted text-sm">
          Nessun elemento. Clicca &quot;Aggiungi&quot; per crearne uno.
        </div>
      )}

      {blocks.map((b) => (
        <BlockRow key={b.id} block={b} />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Componente principale                                               */
/* ------------------------------------------------------------------ */
export function HomepageBlocksManager({ newsBlocks, linkBlocks }: Props) {
  return (
    <div className="space-y-6">
      <BlocksSection
        tipo="news"
        blocks={newsBlocks}
        icon={<Newspaper className="w-4 h-4" />}
        title="News"
        description="Articoli e comunicati visibili nella sezione news della homepage"
      />
      <BlocksSection
        tipo="link"
        blocks={linkBlocks}
        icon={<Link2 className="w-4 h-4" />}
        title="Link rapidi"
        description="Scorciatoie e link utili mostrati nella homepage"
      />
    </div>
  );
}
