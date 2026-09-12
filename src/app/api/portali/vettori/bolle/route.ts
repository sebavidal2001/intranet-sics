import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import {
  divisoreVolumetricoBolla,
  MutazioneBollaMisura,
  volumeGruppoM3,
} from "@/lib/portali/vettori/misure";
import type {
  BollaDocumento,
  BollaMisura,
  BolleResponse,
  FonteBollaMisura,
  Vettore,
} from "@/lib/portali/vettori/tipi";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const Query = z.object({
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  perPagina: z.coerce.number().int().min(20).max(200).default(80),
});

interface DocumentoRow {
  id_documento: number;
  numero_documento: string | null;
  data_documento: string | null;
  data_creazione: string | null;
  direzione: string | null;
  soggetto: string | null;
  destinazione_codificata: string | null;
  dest_rag_soc: string | null;
  vettore_codice: string | null;
  vettore: string | null;
  num_colli: number | null;
  peso_lordo: number | null;
  peso_netto: number | null;
  volume: number | null;
}

interface MisuraRow {
  id: string;
  id_documento: number;
  quantita: number;
  lunghezza_cm: number;
  larghezza_cm: number;
  altezza_cm: number;
  peso_reale_kg: number | null;
  volume_m3: number;
  fonte: FonteBollaMisura;
  inserito_il: string;
  modificato_il: string;
}

interface VettoreRow {
  codice: string;
  nome: string;
  divisore_volumetrico: number;
}

function numeroPositivo(valore: number | null): number | null {
  return valore !== null && Number(valore) > 0 ? Number(valore) : null;
}

function mappaMisura(riga: MisuraRow): BollaMisura {
  return {
    id: riga.id,
    idDocumento: riga.id_documento,
    quantita: Number(riga.quantita),
    lunghezzaCm: Number(riga.lunghezza_cm),
    larghezzaCm: Number(riga.larghezza_cm),
    altezzaCm: Number(riga.altezza_cm),
    pesoRealeKg: numeroPositivo(riga.peso_reale_kg),
    volumeM3: Number(riga.volume_m3),
    fonte: riga.fonte,
    inseritoIl: riga.inserito_il,
    modificatoIl: riga.modificato_il,
  };
}

function mappaDocumento(
  riga: DocumentoRow,
  misure: BollaMisura[],
  vettori: ReadonlyArray<
    Pick<Vettore, "codice" | "nome" | "divisoreVolumetrico">
  >
): BollaDocumento {
  const volumeGestionaleM3 = numeroPositivo(riga.volume);
  return {
    idDocumento: riga.id_documento,
    numeroDocumento: riga.numero_documento,
    dataDocumento: riga.data_documento,
    dataCreazione: riga.data_creazione,
    direzione: riga.direzione,
    soggetto: riga.soggetto,
    destinazione: riga.destinazione_codificata ?? riga.dest_rag_soc,
    vettoreCodice: riga.vettore_codice,
    vettore: riga.vettore,
    numColli: numeroPositivo(riga.num_colli),
    pesoLordoKg: numeroPositivo(riga.peso_lordo),
    pesoNettoKg: numeroPositivo(riga.peso_netto),
    volumeGestionaleM3,
    divisoreVolumetrico: divisoreVolumetricoBolla(
      riga.vettore_codice,
      riga.vettore,
      vettori
    ),
    statoMisure: volumeGestionaleM3
      ? "volume_gestionale"
      : misure.length > 0
        ? "misurata"
        : "da_misurare",
    misure,
  };
}

/** Elenco paginato, riletto solo quando la pagina viene caricata o aggiornata. */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireVettori({
      ruoli: [VETTORI_RUOLI.magazzino, VETTORI_RUOLI.amministrazione],
    });
    if (!guard.ok) return guard.response;

    const parsed = Query.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Paginazione non valida." }, { status: 400 });
    }

    const { pagina, perPagina } = parsed.data;
    const da = (pagina - 1) * perPagina;
    const admin = createAdminClient();
    const [documentiResult, vettoriResult] = await Promise.all([
      admin
        .schema("bi")
        .from("trasporti_documenti")
        .select(
          "id_documento,numero_documento,data_documento,data_creazione,direzione,soggetto,destinazione_codificata,dest_rag_soc,vettore_codice,vettore,num_colli,peso_lordo,peso_netto,volume",
          { count: "exact" }
        )
        .order("data_creazione", { ascending: false, nullsFirst: false })
        .range(da, da + perPagina - 1),
      admin
        .schema("vettori")
        .from("vettori")
        .select("codice,nome,divisore_volumetrico")
        .eq("attivo", true),
    ]);

    const { data, count, error } = documentiResult;
    const { data: vettoriData, error: vettoriError } = vettoriResult;

    if (error) throw new Error(error.message);
    if (vettoriError) throw new Error(vettoriError.message);
    const documenti = (data ?? []) as unknown as DocumentoRow[];
    const vettori = ((vettoriData ?? []) as unknown as VettoreRow[]).map((vettore) => ({
      codice: vettore.codice,
      nome: vettore.nome,
      divisoreVolumetrico: Number(vettore.divisore_volumetrico),
    }));
    const ids = documenti.map((riga) => riga.id_documento);
    const misurePerDocumento = new Map<number, BollaMisura[]>();

    if (ids.length > 0) {
      const { data: misureData, error: misureError } = await admin
        .schema("vettori")
        .from("bolla_misure")
        .select(
          "id,id_documento,quantita,lunghezza_cm,larghezza_cm,altezza_cm,peso_reale_kg,volume_m3,fonte,inserito_il,modificato_il"
        )
        .in("id_documento", ids)
        .order("inserito_il", { ascending: true });
      if (misureError) throw new Error(misureError.message);

      for (const riga of (misureData ?? []) as unknown as MisuraRow[]) {
        const elenco = misurePerDocumento.get(riga.id_documento) ?? [];
        elenco.push(mappaMisura(riga));
        misurePerDocumento.set(riga.id_documento, elenco);
      }
    }

    const totale = count ?? documenti.length;
    const risposta: BolleResponse = {
      documenti: documenti.map((riga) =>
        mappaDocumento(riga, misurePerDocumento.get(riga.id_documento) ?? [], vettori)
      ),
      pagina,
      perPagina,
      totale,
      altrePagine: da + documenti.length < totale,
    };
    return NextResponse.json(risposta, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logError("vettori.bolle", "lettura bolle fallita", error);
    return NextResponse.json(
      { error: "Non è stato possibile leggere le bolle." },
      { status: 500 }
    );
  }
}

async function volumeGestionale(idDocumento: number): Promise<number | null | undefined> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("bi")
    .from("trasporti_documenti")
    .select("id_documento,volume")
    .eq("id_documento", idDocumento)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;
  const riga = data as unknown as { volume: number | null };
  return numeroPositivo(riga.volume);
}

/** Crea, modifica o elimina un singolo gruppo omogeneo di colli. */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori({
      ruoli: [VETTORI_RUOLI.magazzino, VETTORI_RUOLI.amministrazione],
    });
    if (!guard.ok) return guard.response;

    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
    }

    const parsed = MutazioneBollaMisura.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Misure non valide.", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const comando = parsed.data;
    const admin = createAdminClient();

    if (comando.operazione === "elimina") {
      const { data, error } = await admin
        .schema("vettori")
        .from("bolla_misure")
        .delete()
        .eq("id", comando.id)
        .eq("id_documento", comando.idDocumento)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        return NextResponse.json({ error: "Gruppo di colli non trovato." }, { status: 404 });
      }
      return NextResponse.json({ eliminato: comando.id });
    }

    const volumeEsistente = await volumeGestionale(comando.idDocumento);
    if (volumeEsistente === undefined) {
      return NextResponse.json({ error: "Bolla non trovata." }, { status: 404 });
    }
    // Il volume del gestionale NON blocca la misura manuale. È un dato dichiarato,
    // spesso dal vettore, e non equivale a una verifica: chi ha il collo davanti è
    // l'unico che può accorgersi che è sbagliato. Si conservano entrambi — quello
    // grezzo in bi.trasporti_documenti, questo con la sua `fonte` — e la pagina
    // segnala la differenza invece di impedirla.

    const adesso = new Date().toISOString();
    const valori = {
      quantita: comando.quantita,
      lunghezza_cm: comando.lunghezzaCm,
      larghezza_cm: comando.larghezzaCm,
      altezza_cm: comando.altezzaCm,
      peso_reale_kg: comando.pesoRealeKg ?? null,
      volume_m3: Number(volumeGruppoM3(comando).toFixed(6)),
      fonte: "manuale" as const,
      modificato_da: guard.user.id,
      modificato_il: adesso,
    };

    const query = comando.operazione === "crea"
      ? admin
          .schema("vettori")
          .from("bolla_misure")
          .insert({
            ...valori,
            id_documento: comando.idDocumento,
            inserito_da: guard.user.id,
            inserito_il: adesso,
          })
      : admin
          .schema("vettori")
          .from("bolla_misure")
          .update(valori)
          .eq("id", comando.id)
          .eq("id_documento", comando.idDocumento);

    const { data, error } = await query
      .select(
        "id,id_documento,quantita,lunghezza_cm,larghezza_cm,altezza_cm,peso_reale_kg,volume_m3,fonte,inserito_il,modificato_il"
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json({ error: "Gruppo di colli non trovato." }, { status: 404 });
    }

    return NextResponse.json({ misura: mappaMisura(data as unknown as MisuraRow) });
  } catch (error) {
    logError("vettori.bolle", "salvataggio misure fallito", error);
    return NextResponse.json(
      { error: "Non è stato possibile salvare le misure." },
      { status: 500 }
    );
  }
}
