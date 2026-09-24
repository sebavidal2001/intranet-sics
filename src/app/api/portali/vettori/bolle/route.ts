import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import {
  haRuoloFunzionale,
  VETTORI_RUOLI,
} from "@/lib/portali/vettori/ruoli";
import {
  aggiornaBolla,
  campiForzatiDaDb,
  creaBollaManuale,
  ErroreBollaCongelata,
  ErroreBollaDuplicata,
  MutazioneTestataBolla,
  ripristinaCampoBolla,
  risolviVettoreGestionale,
  sincronizzaBolleGestionali,
} from "@/lib/portali/vettori/bolle";
import type { CodiceGestionaleVettore } from "@/lib/portali/vettori/bolle";
import {
  MutazioneBollaMisura,
  volumeGruppoM3,
} from "@/lib/portali/vettori/misure";
import type { BollaGestionale } from "@/lib/portali/vettori/abbinamento";
import type {
  BollaDocumento,
  BollaFattura,
  BollaMisura,
  BollaScostamento,
  BollaVettoreOpzione,
  BolleResponse,
  FonteBollaMisura,
  OrigineSpedizione,
} from "@/lib/portali/vettori/tipi";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const Query = z.object({
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  perPagina: z.coerce.number().int().min(20).max(200).default(80),
  /** `1` mostra anche le bolle il cui trasporto non paghiamo noi. */
  tutte: z.enum(["0", "1"]).default("0"),
  cerca: z.string().trim().max(60).optional(),
});

/**
 * Quali bolle arrivano al banco.
 *
 * L'amministrazione controlla le fatture dei vettori, quindi le bolle che
 * contano sono quelle che il vettore fattura a noi: partenze in porto franco o
 * franco con addebito in fattura, arrivi in porto assegnato. Le altre (2.340
 * su 4.000 al 24/09/2026, quasi tutte partenze in assegnato) erano rumore.
 * Restano visibili le bolle inserite a mano o dalla simulazione, e quelle di
 * cui il porto non si conosce: nascondere un dubbio sarebbe peggio.
 */
const FILTRO_A_NOSTRO_CARICO =
  "a_nostro_carico.is.true,a_nostro_carico.is.null,origine.in.(manuale,simulazione)";

/** Solo lettere, cifre e pochi separatori: il testo finisce in un filtro PostgREST. */
function testoRicerca(cerca: string | undefined): string | null {
  const pulito = (cerca ?? "").replace(/[^\p{L}\p{N} ./-]/gu, "").trim();
  return pulito.length > 0 ? pulito : null;
}

interface SpedizioneRow {
  id: string;
  direzione: "entrata" | "uscita";
  vettore_id: string | null;
  numero_riferimento: string | null;
  numero_protocollo: string | null;
  data_documento: string;
  controparte_nome: string | null;
  zona_cap: string | null;
  zona_provincia: string | null;
  porto_descrizione: string | null;
  a_nostro_carico: boolean | null;
  riaddebito_previsto: number | null;
  colli_bolla: number | null;
  peso_bolla: number | null;
  origine: OrigineSpedizione;
  campi_forzati: unknown;
  congelata: boolean;
  creata_il: string;
}

interface MisuraRow {
  id: string;
  spedizione_id: string;
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
  id: string;
  codice: string;
  nome: string;
  divisore_volumetrico: number;
}

interface CodiceGestionaleRow {
  codice_gestionale: string;
  ragione_sociale: string;
  vettore_id: string | null;
  tipo: CodiceGestionaleVettore["tipo"];
  regola_testo: string | null;
}

interface DocumentoGestionaleRow {
  id_documento: number;
  vettore_codice: string | null;
  vettore: string | null;
}

interface ControlloRow {
  id: string;
  spedizione_id: string;
  fattura_riga_id: string;
  calcolato_il: string;
}

interface FatturaRigaRow {
  id: string;
  fattura_id: string;
}

interface FatturaRow {
  id: string;
  numero: string;
  data_fattura: string;
}

interface ScostamentoRow {
  id: string;
  spedizione_id: string;
  id_documento: number;
  differenze: BollaScostamento["differenze"];
  rilevato_il: string;
}

function numeroPositivo(valore: number | null): number | null {
  return valore !== null && Number(valore) > 0 ? Number(valore) : null;
}

function mappaMisura(riga: MisuraRow): BollaMisura {
  return {
    id: riga.id,
    spedizioneId: riga.spedizione_id,
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

function mappaVettore(riga: VettoreRow): BollaVettoreOpzione {
  return {
    id: riga.id,
    codice: riga.codice,
    nome: riga.nome,
    divisoreVolumetrico: Number(riga.divisore_volumetrico),
  };
}

async function sincronizzaDocumentiRecenti(): Promise<void> {
  const admin = createAdminClient();
  // La pipeline scrive soltanto il grezzo in `bi`. La lettura della coda e'
  // il punto in cui le testate recenti vengono fuse nelle spedizioni operative;
  // 500 documenti coprono ampiamente la finestra di lavoro al banco senza
  // rileggere a ogni apertura l'intero storico.
  const { data, error } = await admin
    .schema("bi")
    .from("trasporti_documenti")
    .select(
      "id_documento,codice_profilo,tipo_registro,numero_progressivo,numero_documento,data_documento,data_registrazione,id_sog_commerciale,codice_soggetto,soggetto,zona_cap,zona_provincia,fonte_zona,tipo_trasporto_codice,tipo_trasporto,tras_mezzo,vettore_codice,vettore,num_colli,peso_netto,peso_lordo,volume"
    )
    .order("data_creazione", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(error.message);
  await sincronizzaBolleGestionali((data ?? []) as unknown as BollaGestionale[]);
}

/** Elenco paginato delle spedizioni operative, dopo la fusione del grezzo recente. */
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

    await sincronizzaDocumentiRecenti();

    const { pagina, perPagina, tutte } = parsed.data;
    const cerca = testoRicerca(parsed.data.cerca);
    const da = (pagina - 1) * perPagina;
    const admin = createAdminClient();
    let elenco = admin
      .schema("vettori")
      .from("spedizioni")
      .select(
        "id,direzione,vettore_id,numero_riferimento,numero_protocollo,data_documento,controparte_nome,zona_cap,zona_provincia,porto_descrizione,a_nostro_carico,riaddebito_previsto,colli_bolla,peso_bolla,origine,campi_forzati,congelata,creata_il",
        { count: "exact" }
      )
      // Le spedizioni ignorate non arrivano al banco: sono le righe dei fogli
      // Excel riconosciute come doppioni di una bolla gia' presente, e
      // misurare i colli due volte sulla stessa merce non ha senso.
      .neq("stato", "ignorata");
    let escluse = admin
      .schema("vettori")
      .from("spedizioni")
      .select("id", { count: "exact", head: true })
      .neq("stato", "ignorata")
      .eq("a_nostro_carico", false)
      .not("origine", "in", "(manuale,simulazione)");
    if (tutte === "0") elenco = elenco.or(FILTRO_A_NOSTRO_CARICO);
    if (cerca) {
      const filtro = `numero_riferimento.ilike.*${cerca}*,numero_protocollo.ilike.*${cerca}*,controparte_nome.ilike.*${cerca}*`;
      elenco = elenco.or(filtro);
      escluse = escluse.or(filtro);
    }
    const [spedizioniResult, vettoriResult, codiciGestionaliResult, esclusiResult] = await Promise.all([
      elenco
        .order("data_documento", { ascending: false })
        .order("creata_il", { ascending: false })
        .range(da, da + perPagina - 1),
      admin
        .schema("vettori")
        .from("vettori")
        .select("id,codice,nome,divisore_volumetrico")
        .eq("attivo", true)
        .order("nome"),
      admin
        .schema("vettori")
        .from("codici_gestionale")
        .select("codice_gestionale,ragione_sociale,vettore_id,tipo,regola_testo"),
      tutte === "0" ? escluse : Promise.resolve({ count: 0, error: null }),
    ]);

    if (spedizioniResult.error) throw new Error(spedizioniResult.error.message);
    if (esclusiResult.error) throw new Error(esclusiResult.error.message);
    if (vettoriResult.error) throw new Error(vettoriResult.error.message);
    if (codiciGestionaliResult.error) throw new Error(codiciGestionaliResult.error.message);
    const spedizioni = (spedizioniResult.data ?? []) as unknown as SpedizioneRow[];
    const vettori = ((vettoriResult.data ?? []) as unknown as VettoreRow[]).map(mappaVettore);
    const vettoriPerId = new Map(vettori.map((vettore) => [vettore.id, vettore]));
    const codiciGestionali = new Map(
      ((codiciGestionaliResult.data ?? []) as unknown as CodiceGestionaleRow[]).map(
        (riga): [string, CodiceGestionaleVettore] => [
          riga.codice_gestionale.trim().toUpperCase(),
          {
            codiceGestionale: riga.codice_gestionale,
            ragioneSociale: riga.ragione_sociale,
            vettoreId: riga.vettore_id,
            tipo: riga.tipo,
            regolaTesto: riga.regola_testo,
          },
        ]
      )
    );
    const ids = spedizioni.map((spedizione) => spedizione.id);

    const misurePerSpedizione = new Map<string, BollaMisura[]>();
    const documentiPerSpedizione = new Map<string, number[]>();
    const fatturePerSpedizione = new Map<string, BollaFattura>();
    const scostamentiPerSpedizione = new Map<string, BollaScostamento[]>();
    const gestionalePerDocumento = new Map<number, DocumentoGestionaleRow>();

    if (ids.length > 0) {
      const [misureResult, documentiResult, controlliResult, scostamentiResult] = await Promise.all([
        admin
          .schema("vettori")
          .from("bolla_misure")
          .select("id,spedizione_id,quantita,lunghezza_cm,larghezza_cm,altezza_cm,peso_reale_kg,volume_m3,fonte,inserito_il,modificato_il")
          .in("spedizione_id", ids)
          .order("inserito_il", { ascending: true }),
        admin
          .schema("vettori")
          .from("spedizioni_documenti")
          .select("spedizione_id,id_documento")
          .in("spedizione_id", ids),
        admin
          .schema("vettori")
          .from("controlli")
          .select("id,spedizione_id,fattura_riga_id,calcolato_il")
          .in("spedizione_id", ids)
          .order("calcolato_il", { ascending: false }),
        admin
          .schema("vettori")
          .from("spedizioni_scostamenti")
          .select("id,spedizione_id,id_documento,differenze,rilevato_il")
          .in("spedizione_id", ids)
          .order("rilevato_il", { ascending: false }),
      ]);
      for (const result of [misureResult, documentiResult, controlliResult, scostamentiResult]) {
        if (result.error) throw new Error(result.error.message);
      }

      for (const riga of (misureResult.data ?? []) as unknown as MisuraRow[]) {
        const elenco = misurePerSpedizione.get(riga.spedizione_id) ?? [];
        elenco.push(mappaMisura(riga));
        misurePerSpedizione.set(riga.spedizione_id, elenco);
      }
      for (const riga of (documentiResult.data ?? []) as unknown as Array<{ spedizione_id: string; id_documento: number }>) {
        const elenco = documentiPerSpedizione.get(riga.spedizione_id) ?? [];
        elenco.push(riga.id_documento);
        documentiPerSpedizione.set(riga.spedizione_id, elenco);
      }
      const documentiIds = [...new Set([...documentiPerSpedizione.values()].flat())];
      if (documentiIds.length > 0) {
        const { data: gestionaliData, error: gestionaliError } = await admin
          .schema("bi")
          .from("trasporti_documenti")
          .select("id_documento,vettore_codice,vettore")
          .in("id_documento", documentiIds);
        if (gestionaliError) throw new Error(gestionaliError.message);
        for (const riga of (gestionaliData ?? []) as unknown as DocumentoGestionaleRow[]) {
          gestionalePerDocumento.set(riga.id_documento, riga);
        }
      }
      for (const riga of (scostamentiResult.data ?? []) as unknown as ScostamentoRow[]) {
        const elenco = scostamentiPerSpedizione.get(riga.spedizione_id) ?? [];
        elenco.push({
          id: riga.id,
          idDocumento: riga.id_documento,
          differenze: riga.differenze,
          rilevatoIl: riga.rilevato_il,
        });
        scostamentiPerSpedizione.set(riga.spedizione_id, elenco);
      }

      const controlli = (controlliResult.data ?? []) as unknown as ControlloRow[];
      const righeIds = controlli.map((controllo) => controllo.fattura_riga_id);
      if (righeIds.length > 0) {
        const { data: righeData, error: righeError } = await admin
          .schema("vettori")
          .from("fatture_righe")
          .select("id,fattura_id")
          .in("id", righeIds);
        if (righeError) throw new Error(righeError.message);
        const righe = (righeData ?? []) as unknown as FatturaRigaRow[];
        const fatturaIds = [...new Set(righe.map((riga) => riga.fattura_id))];
        const { data: fattureData, error: fattureError } = await admin
          .schema("vettori")
          .from("fatture")
          .select("id,numero,data_fattura")
          .in("id", fatturaIds);
        if (fattureError) throw new Error(fattureError.message);
        const fatture = new Map(
          ((fattureData ?? []) as unknown as FatturaRow[]).map((fattura) => [fattura.id, fattura])
        );
        const righePerId = new Map(righe.map((riga) => [riga.id, riga]));
        for (const controllo of controlli) {
          if (fatturePerSpedizione.has(controllo.spedizione_id)) continue;
          const riga = righePerId.get(controllo.fattura_riga_id);
          const fattura = riga ? fatture.get(riga.fattura_id) : undefined;
          if (fattura) {
            fatturePerSpedizione.set(controllo.spedizione_id, {
              controlloId: controllo.id,
              numero: fattura.numero,
              data: fattura.data_fattura,
            });
          }
        }
      }
    }

    const documenti: BollaDocumento[] = spedizioni.map((spedizione) => {
      const misure = misurePerSpedizione.get(spedizione.id) ?? [];
      const vettore = spedizione.vettore_id
        ? vettoriPerId.get(spedizione.vettore_id) ?? null
        : null;
      const documentoGestionale = (documentiPerSpedizione.get(spedizione.id) ?? [])
        .map((idDocumento) => gestionalePerDocumento.get(idDocumento))
        .find((documento) => documento?.vettore_codice?.trim());
      const risoluzioneGestionale = risolviVettoreGestionale(
        documentoGestionale?.vettore_codice ?? null,
        codiciGestionali
      );
      const vettoreEsito = vettore ? "assegnato" : risoluzioneGestionale.esito;
      const destinazione = [spedizione.zona_cap, spedizione.zona_provincia]
        .filter(Boolean)
        .join(" ") || null;
      return {
        idSpedizione: spedizione.id,
        idDocumenti: documentiPerSpedizione.get(spedizione.id) ?? [],
        numeroDocumento: spedizione.numero_riferimento,
        numeroProtocollo: spedizione.numero_protocollo,
        dataDocumento: spedizione.data_documento,
        dataCreazione: spedizione.creata_il,
        direzione: spedizione.direzione,
        soggetto: spedizione.controparte_nome,
        destinazione,
        vettoreId: spedizione.vettore_id,
        vettoreCodice: vettore?.codice ?? null,
        vettore:
          vettore?.nome ??
          risoluzioneGestionale.ragioneSociale ??
          documentoGestionale?.vettore ??
          null,
        vettoreCodiceGestionale: risoluzioneGestionale.codiceGestionale,
        vettoreEsito,
        vettoreRegola: risoluzioneGestionale.regola,
        numColli: numeroPositivo(spedizione.colli_bolla),
        porto: spedizione.porto_descrizione,
        aNostroCarico: spedizione.a_nostro_carico,
        riaddebitoPrevisto:
          spedizione.riaddebito_previsto === null ? null : Number(spedizione.riaddebito_previsto),
        pesoLordoKg: numeroPositivo(spedizione.peso_bolla),
        pesoNettoKg: null,
        divisoreVolumetrico: vettore?.divisoreVolumetrico ?? null,
        statoMisure: misure.length > 0 ? "misurata" : "da_misurare",
        origine: spedizione.origine,
        campiForzati: campiForzatiDaDb(spedizione.campi_forzati),
        congelata: spedizione.congelata,
        fattura: fatturePerSpedizione.get(spedizione.id) ?? null,
        scostamenti: scostamentiPerSpedizione.get(spedizione.id) ?? [],
        misure,
      };
    });

    const totale = spedizioniResult.count ?? documenti.length;
    const risposta: BolleResponse = {
      documenti,
      vettori,
      puoScongelare: haRuoloFunzionale(guard.ctx, [VETTORI_RUOLI.amministrazione]),
      pagina,
      perPagina,
      totale,
      altrePagine: da + documenti.length < totale,
      nonANostroCarico: esclusiResult.count ?? 0,
    };
    return NextResponse.json(risposta, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("vettori.bolle", "lettura bolle fallita", error);
    return NextResponse.json(
      { error: "Non e stato possibile leggere le bolle." },
      { status: 500 }
    );
  }
}

async function mutaMisura(
  comando: z.infer<typeof MutazioneBollaMisura>,
  utenteId: string
) {
  const admin = createAdminClient();
  if (comando.operazione === "elimina") {
    const { data, error } = await admin
      .schema("vettori")
      .from("bolla_misure")
      .delete()
      .eq("id", comando.id)
      .eq("spedizione_id", comando.spedizioneId)
      .select("id")
      .maybeSingle();
    if (error?.code === "55000") throw new ErroreBollaCongelata();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Gruppo di colli non trovato." }, { status: 404 });
    return NextResponse.json({ eliminato: comando.id });
  }

  const adesso = new Date().toISOString();
  const valori = {
    quantita: comando.quantita,
    lunghezza_cm: comando.lunghezzaCm,
    larghezza_cm: comando.larghezzaCm,
    altezza_cm: comando.altezzaCm,
    peso_reale_kg: comando.pesoRealeKg ?? null,
    volume_m3: Number(volumeGruppoM3(comando).toFixed(6)),
    fonte: "manuale" as const,
    modificato_da: utenteId,
    modificato_il: adesso,
  };
  const query = comando.operazione === "crea"
    ? admin
        .schema("vettori")
        .from("bolla_misure")
        .insert({
          ...valori,
          spedizione_id: comando.spedizioneId,
          inserito_da: utenteId,
          inserito_il: adesso,
        })
    : admin
        .schema("vettori")
        .from("bolla_misure")
        .update(valori)
        .eq("id", comando.id)
        .eq("spedizione_id", comando.spedizioneId);
  const { data, error } = await query
    .select("id,spedizione_id,quantita,lunghezza_cm,larghezza_cm,altezza_cm,peso_reale_kg,volume_m3,fonte,inserito_il,modificato_il")
    .maybeSingle();
  if (error?.code === "55000") throw new ErroreBollaCongelata();
  if (error) throw new Error(error.message);
  if (!data) return NextResponse.json({ error: "Gruppo di colli non trovato." }, { status: 404 });
  return NextResponse.json({ misura: mappaMisura(data as unknown as MisuraRow) });
}

/** Tutte le mutazioni hanno Zod e guard funzionale; lo scongelamento restringe ad amministrazione. */
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

    const testata = MutazioneTestataBolla.safeParse(corpo);
    if (testata.success) {
      const comando = testata.data;
      if (comando.operazione === "crea_bolla") {
        const id = await creaBollaManuale(comando, guard.user.id);
        return NextResponse.json({ id }, { status: 201 });
      }
      if (comando.operazione === "aggiorna_bolla") {
        await aggiornaBolla(comando, guard.user.id);
        return NextResponse.json({ aggiornata: comando.spedizioneId });
      }
      if (comando.operazione === "ripristina_campo") {
        await ripristinaCampoBolla(comando.spedizioneId, comando.campo);
        return NextResponse.json({ ripristinato: comando.campo });
      }
      if (!haRuoloFunzionale(guard.ctx, [VETTORI_RUOLI.amministrazione])) {
        return NextResponse.json(
          { error: "Solo amministrazione puo scongelare una bolla." },
          { status: 403 }
        );
      }
      const admin = createAdminClient();
      const { data, error } = await admin
        .schema("vettori")
        .rpc("scongela_spedizione", {
          p_spedizione_id: comando.spedizioneId,
          p_utente_id: guard.user.id,
          p_motivo: comando.motivo,
        });
      if (error) throw new Error(error.message);
      if (data !== true) {
        return NextResponse.json({ error: "Bolla non trovata o gia scongelata." }, { status: 404 });
      }
      return NextResponse.json({ scongelata: comando.spedizioneId });
    }

    const misura = MutazioneBollaMisura.safeParse(corpo);
    if (!misura.success) {
      return NextResponse.json(
        { error: "Dati non validi.", dettagli: misura.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return await mutaMisura(misura.data, guard.user.id);
  } catch (error) {
    if (error instanceof ErroreBollaDuplicata) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ErroreBollaCongelata) {
      return NextResponse.json({ error: error.message }, { status: 423 });
    }
    logError("vettori.bolle", "mutazione bolla fallita", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Non e stato possibile salvare la bolla." },
      { status: 500 }
    );
  }
}
