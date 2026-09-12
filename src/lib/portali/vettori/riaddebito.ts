import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AccordoRiaddebitoCliente,
  BasePesoRiaddebito,
  EsitoRiaddebito,
  ScaglioneRiaddebito,
  VersioneRiaddebito,
} from "./tipi";

interface RigaScaglione {
  valido_dal: string;
  valido_al: string | null;
  base_peso: BasePesoRiaddebito;
  peso_da: number | string;
  peso_a: number | string | null;
  importo: number | string | null;
  nota: string | null;
}

interface RigaAccordo {
  id: string;
  codice_cliente: string;
  ragione_sociale: string | null;
  valido_dal: string;
  valido_al: string | null;
  modalita: AccordoRiaddebitoCliente["modalita"];
  importo: number | string | null;
  nota: string | null;
}

export interface ParametriRiaddebito {
  data: string;
  pesoReale: number;
  pesoTassabile: number;
  versione: VersioneRiaddebito;
  accordo?: AccordoRiaddebitoCliente | null;
}

function euro(valore: number): number {
  return Math.round((valore + Number.EPSILON) * 100) / 100;
}

function dataNelPeriodo(data: string, dal: string, al: string | null): boolean {
  return data >= dal && (al === null || data <= al);
}

function descriviScaglione(scaglione: ScaglioneRiaddebito): string {
  return scaglione.pesoA === null
    ? `scaglione oltre ${scaglione.pesoDa} kg`
    : `scaglione ${scaglione.pesoDa}-${scaglione.pesoA} kg`;
}

/**
 * Calcola il riaddebito senza I/O e senza date implicite.
 *
 * La data viene verificata anche qui: passare per errore un accordo storico non
 * deve cambiare il prezzo solo perche' il caricamento a monte era troppo largo.
 */
export function calcolaRiaddebito(parametri: ParametriRiaddebito): EsitoRiaddebito {
  const { accordo, versione } = parametri;
  const pesoUsato = versione.basePeso === "reale"
    ? parametri.pesoReale
    : parametri.pesoTassabile;

  if (accordo && dataNelPeriodo(parametri.data, accordo.validoDal, accordo.validoAl)) {
    if (accordo.modalita === "nessun_addebito") {
      return {
        importo: 0,
        pesoUsato,
        basePeso: versione.basePeso,
        regola: "accordo cliente: nessun addebito",
        avvertenza: accordo.nota,
      };
    }
    if (accordo.modalita === "importo_fisso") {
      return accordo.importo === null
        ? {
            importo: null,
            pesoUsato,
            basePeso: versione.basePeso,
            regola: "accordo cliente: importo fisso",
            avvertenza: "L'accordo a importo fisso non contiene un importo: verificare la configurazione.",
          }
        : {
            importo: euro(accordo.importo),
            pesoUsato,
            basePeso: versione.basePeso,
            regola: "accordo cliente: importo fisso",
            avvertenza: accordo.nota,
          };
    }
    // `tabella` prosegue intenzionalmente sulla versione generale.
  }

  const scaglione = [...versione.scaglioni]
    .sort((a, b) => a.pesoDa - b.pesoDa)
    .find((riga) => {
      const sopraIlMinimo = pesoUsato > riga.pesoDa || riga.pesoDa === 0;
      const sottoIlMassimo = riga.pesoA === null || pesoUsato <= riga.pesoA;
      return sopraIlMinimo && sottoIlMassimo;
    });

  if (!scaglione) {
    return {
      importo: null,
      pesoUsato,
      basePeso: versione.basePeso,
      regola: "nessuno scaglione applicabile",
      avvertenza: `Nessuno scaglione copre ${pesoUsato} kg: verificare la configurazione del riaddebito.`,
    };
  }

  if (scaglione.importo === null) {
    return {
      importo: null,
      pesoUsato,
      basePeso: versione.basePeso,
      regola: descriviScaglione(scaglione),
      avvertenza: scaglione.nota ?? "Serve chiedere un'offerta per il riaddebito.",
    };
  }

  return {
    importo: euro(scaglione.importo),
    pesoUsato,
    basePeso: versione.basePeso,
    regola: descriviScaglione(scaglione),
    avvertenza: scaglione.nota,
  };
}

/** `null` conserva l'informazione che il ricavo non e' stato determinato. */
export function calcolaMargineRiaddebito(
  riaddebito: EsitoRiaddebito,
  costo: number
): number | null {
  return riaddebito.importo === null ? null : euro(riaddebito.importo - costo);
}

function mappaAccordo(riga: RigaAccordo): AccordoRiaddebitoCliente {
  return {
    id: riga.id,
    codiceCliente: riga.codice_cliente,
    ragioneSociale: riga.ragione_sociale,
    validoDal: riga.valido_dal,
    validoAl: riga.valido_al,
    modalita: riga.modalita,
    importo: riga.importo === null ? null : Number(riga.importo),
    nota: riga.nota,
  };
}

/** Carica la versione completa valida nella data indicata. */
export async function caricaVersioneRiaddebito(
  data: string
): Promise<VersioneRiaddebito | null> {
  const admin = createAdminClient();
  const { data: righe, error } = await admin
    .schema("vettori")
    .from("riaddebito_scaglioni")
    .select("valido_dal,valido_al,base_peso,peso_da,peso_a,importo,nota")
    .lte("valido_dal", data)
    .or(`valido_al.is.null,valido_al.gte.${data}`)
    .order("valido_dal", { ascending: false })
    .order("peso_da", { ascending: true });
  if (error) throw new Error(`Lettura riaddebito fallita: ${error.message}`);

  const tutte = (righe ?? []) as unknown as RigaScaglione[];
  const validoDal = tutte[0]?.valido_dal;
  if (!validoDal) return null;
  const versione = tutte.filter((riga) => riga.valido_dal === validoDal);
  return {
    validoDal,
    validoAl: versione[0]?.valido_al ?? null,
    basePeso: versione[0]?.base_peso ?? "tassabile",
    scaglioni: versione.map((riga) => ({
      pesoDa: Number(riga.peso_da),
      pesoA: riga.peso_a === null ? null : Number(riga.peso_a),
      importo: riga.importo === null ? null : Number(riga.importo),
      nota: riga.nota,
    })),
  };
}

/** Carica l'accordo del cliente valido alla data, se esiste. */
export async function caricaAccordoRiaddebito(
  codiceCliente: string | null | undefined,
  data: string
): Promise<AccordoRiaddebitoCliente | null> {
  const codice = codiceCliente?.trim();
  if (!codice) return null;
  const admin = createAdminClient();
  const { data: righe, error } = await admin
    .schema("vettori")
    .from("riaddebito_clienti")
    .select("id,codice_cliente,ragione_sociale,valido_dal,valido_al,modalita,importo,nota")
    .eq("codice_cliente", codice)
    .lte("valido_dal", data)
    .or(`valido_al.is.null,valido_al.gte.${data}`)
    .order("valido_dal", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Lettura accordo cliente fallita: ${error.message}`);
  const riga = ((righe ?? []) as unknown as RigaAccordo[])[0];
  return riga ? mappaAccordo(riga) : null;
}

/** Elenco amministrativo completo degli accordi, inclusi quelli storici. */
export async function caricaAccordiRiaddebito(): Promise<AccordoRiaddebitoCliente[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vettori")
    .from("riaddebito_clienti")
    .select("id,codice_cliente,ragione_sociale,valido_dal,valido_al,modalita,importo,nota")
    .order("codice_cliente")
    .order("valido_dal", { ascending: false });
  if (error) throw new Error(`Lettura accordi cliente fallita: ${error.message}`);
  return ((data ?? []) as unknown as RigaAccordo[]).map(mappaAccordo);
}
