/**
 * Motore condiviso di fusione delle bolle gestionali.
 *
 * Il modulo e' JavaScript ESM intenzionalmente privo di dipendenze Next: viene
 * usato sia dal codice TypeScript dell'applicazione sia dal loader Node puro.
 * Il client Supabase viene iniettato dal chiamante per non importare il runtime
 * server di Next (`createAdminClient`).
 */

export const CAMPI_BOLLA_FORZABILI = [
  "direzione",
  "numero_riferimento",
  "data_documento",
  "controparte_nome",
  "vettore_id",
  "colli_bolla",
  "peso_bolla",
];

export const CAMPI_BOLLA_GESTIONALE = [
  "id_documento",
  "codice_profilo",
  "tipo_registro",
  "numero_progressivo",
  "numero_documento",
  "data_documento",
  "data_registrazione",
  "id_sog_commerciale",
  "codice_soggetto",
  "soggetto",
  "zona_cap",
  "zona_provincia",
  "fonte_zona",
  "tipo_trasporto_codice",
  "tipo_trasporto",
  "vettore_codice",
  "vettore",
  "num_colli",
  "peso_netto",
  "peso_lordo",
  "volume",
];

export const SELEZIONE_BOLLA_GESTIONALE = CAMPI_BOLLA_GESTIONALE.join(",");

export function normalizzaRiferimento(v) {
  if (!v) return null;
  const pulito = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!pulito) return null;
  const senzaZeri = pulito.replace(/^0+/, "");
  if (!senzaZeri || /^X+$/.test(senzaZeri)) return null;
  return senzaZeri;
}

function numero(v) {
  if (v == null || v === "") return null;
  const valore = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(valore) ? valore : null;
}

export function direzioneDi(bolla) {
  if (bolla.tipo_registro === "DA") return "entrata";
  if (bolla.tipo_registro === "DV") return "uscita";
  if (bolla.codice_profilo === "BF") return "entrata";
  if (bolla.codice_profilo === "BC") return "uscita";
  return null;
}

export function aNostroCarico(direzione, portoCodice) {
  if (!portoCodice) return null;
  return direzione === "uscita"
    ? portoCodice === "01" || portoCodice === "03"
    : portoCodice === "02";
}

export function raggruppaInSpedizioni(bolle) {
  const gruppi = new Map();

  for (const bolla of bolle) {
    const direzione = direzioneDi(bolla);
    if (!direzione) continue;

    const riferimento = direzione === "uscita"
      ? (bolla.numero_progressivo ?? bolla.numero_documento)
      : (bolla.numero_documento ?? bolla.numero_progressivo);
    const riferimentoNorm = normalizzaRiferimento(riferimento);
    const dataDocumento = bolla.data_documento ?? bolla.data_registrazione;
    const chiave = riferimentoNorm
      ? `${direzione}|${bolla.codice_soggetto ?? ""}|${riferimentoNorm}|${dataDocumento ?? ""}`
      : `${direzione}|doc|${bolla.id_documento}`;

    const esistente = gruppi.get(chiave);
    if (esistente) {
      esistente.idDocumenti.push(bolla.id_documento);
      const colli = numero(bolla.num_colli);
      if (colli != null) esistente.colli = (esistente.colli ?? 0) + colli;
      const peso = numero(bolla.peso_lordo) ?? numero(bolla.peso_netto);
      if (peso != null) esistente.peso = (esistente.peso ?? 0) + peso;
      const volume = numero(bolla.volume);
      if (volume != null) esistente.volumeMc = (esistente.volumeMc ?? 0) + volume;
      continue;
    }

    gruppi.set(chiave, {
      chiave,
      direzione,
      riferimento: riferimento ?? null,
      riferimentoNorm,
      dataDocumento,
      codiceControparte: bolla.codice_soggetto,
      controparte: bolla.soggetto,
      zonaCap: bolla.zona_cap,
      zonaProvincia: bolla.zona_provincia,
      portoCodice: bolla.tipo_trasporto_codice,
      porto: bolla.tipo_trasporto,
      aNostroCarico: aNostroCarico(direzione, bolla.tipo_trasporto_codice),
      vettoreCodice: bolla.vettore_codice,
      colli: numero(bolla.num_colli),
      peso: numero(bolla.peso_lordo) ?? numero(bolla.peso_netto),
      volumeMc: numero(bolla.volume),
      idDocumenti: [bolla.id_documento],
    });
  }

  return [...gruppi.values()];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function campiForzatiDaDb(value) {
  if (!isRecord(value)) return {};
  const risultato = {};
  for (const campo of CAMPI_BOLLA_FORZABILI) {
    const dettaglio = value[campo];
    if (
      !isRecord(dettaglio) ||
      !("valore_precedente" in dettaglio) ||
      typeof dettaglio.forzato_da !== "string" ||
      typeof dettaglio.forzato_il !== "string"
    ) {
      continue;
    }
    const precedente = dettaglio.valore_precedente;
    if (
      precedente !== null &&
      typeof precedente !== "string" &&
      typeof precedente !== "number" &&
      typeof precedente !== "boolean"
    ) {
      continue;
    }
    risultato[campo] = {
      valorePrecedente: precedente,
      forzatoDa: dettaglio.forzato_da,
      forzatoIl: dettaglio.forzato_il,
    };
  }
  return risultato;
}

export function campiForzatiPerDb(value) {
  return Object.fromEntries(
    Object.entries(value).map(([campo, dettaglio]) => [
      campo,
      {
        valore_precedente: dettaglio?.valorePrecedente ?? null,
        forzato_da: dettaglio?.forzatoDa,
        forzato_il: dettaglio?.forzatoIl,
      },
    ])
  );
}

export function pianificaFusioneCampi(attuali, gestionali, forzati, congelata) {
  const aggiornamenti = {};
  const differenze = {};
  for (const campo of CAMPI_BOLLA_FORZABILI) {
    if (attuali[campo] !== gestionali[campo]) {
      differenze[campo] = {
        spedizione: attuali[campo],
        gestionale: gestionali[campo],
      };
    }
    if (!congelata && !forzati[campo]) aggiornamenti[campo] = gestionali[campo];
  }
  return { aggiornamenti, differenze };
}

export function documentiGestionaliDelRun(righe) {
  return righe.map((riga) => Object.fromEntries(
    CAMPI_BOLLA_GESTIONALE.map((campo) => [campo, riga[campo] ?? null])
  ));
}

function dettagliDocumenti(bolle) {
  return new Map(
    bolle.map((bolla) => [
      bolla.id_documento,
      {
        codiceProfilo: bolla.codice_profilo,
        tipoRegistro: bolla.tipo_registro,
        numeroProgressivo: bolla.numero_progressivo,
        numeroDocumento: bolla.numero_documento,
      },
    ])
  );
}

function valoreRiga(riga, campo) {
  return riga[campo];
}

function valoriGestionali(spedizione, vettoreId) {
  return {
    direzione: spedizione.direzione,
    vettore_id: vettoreId,
    numero_riferimento: spedizione.riferimento,
    numero_riferimento_norm: spedizione.riferimentoNorm,
    data_documento: spedizione.dataDocumento,
    controparte_codice: spedizione.codiceControparte,
    controparte_nome: spedizione.controparte,
    zona_cap: spedizione.zonaCap,
    zona_provincia: spedizione.zonaProvincia,
    fonte_zona: null,
    porto_codice: spedizione.portoCodice,
    porto_descrizione: spedizione.porto,
    a_nostro_carico: spedizione.aNostroCarico,
    colli_bolla: spedizione.colli,
    peso_bolla: spedizione.peso,
  };
}

function differenzeGestionali(riga, valori) {
  return pianificaFusioneCampi(
    Object.fromEntries(
      CAMPI_BOLLA_FORZABILI.map((campo) => [campo, valoreRiga(riga, campo)])
    ),
    Object.fromEntries(
      CAMPI_BOLLA_FORZABILI.map((campo) => [campo, valori[campo]])
    ),
    campiForzatiDaDb(riga.campi_forzati),
    riga.congelata
  ).differenze;
}

export async function sincronizzaBolleGestionali(admin, bolle) {
  await sincronizzaSpedizioniGestionali(
    admin,
    raggruppaInSpedizioni(bolle),
    dettagliDocumenti(bolle)
  );
}

export async function sincronizzaSpedizioniGestionali(
  admin,
  spedizioni,
  dettagli = new Map()
) {
  const valide = spedizioni.filter((spedizione) => spedizione.dataDocumento);
  if (valide.length === 0) return;

  const { data: vettoriData, error: vettoriError } = await admin
    .schema("vettori")
    .from("vettori")
    .select("id,codice");
  if (vettoriError) throw new Error(vettoriError.message);
  const vettori = new Map(
    (vettoriData ?? []).map((riga) => [riga.codice.toLowerCase(), riga.id])
  );

  for (const spedizione of valide) {
    const idDocumenti = spedizione.idDocumenti;
    const { data: legami, error: legamiError } = await admin
      .schema("vettori")
      .from("spedizioni_documenti")
      .select("spedizione_id")
      .in("id_documento", idDocumenti)
      .limit(1);
    if (legamiError) throw new Error(legamiError.message);

    let spedizioneId = legami?.[0]?.spedizione_id;
    if (!spedizioneId && spedizione.riferimentoNorm) {
      const { data: candidati, error: candidatiError } = await admin
        .schema("vettori")
        .from("spedizioni")
        .select("id")
        .eq("direzione", spedizione.direzione)
        .eq("numero_riferimento_norm", spedizione.riferimentoNorm)
        .eq("data_documento", spedizione.dataDocumento)
        .order("creata_il", { ascending: true })
        .limit(2);
      if (candidatiError) throw new Error(candidatiError.message);
      if ((candidati ?? []).length === 1) spedizioneId = candidati[0].id;
    }

    const vettoreId = spedizione.vettoreCodice
      ? vettori.get(spedizione.vettoreCodice.toLowerCase()) ?? null
      : null;
    const valori = valoriGestionali(spedizione, vettoreId);

    if (!spedizioneId) {
      const { data: nuova, error: insertError } = await admin
        .schema("vettori")
        .from("spedizioni")
        .insert({ ...valori, origine: "gestionale", stato: "attesa" })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);
      spedizioneId = nuova.id;
    }

    const legamiDaInserire = idDocumenti.map((idDocumento) => {
      const dettaglio = dettagli.get(idDocumento);
      return {
        spedizione_id: spedizioneId,
        id_documento: idDocumento,
        codice_profilo: dettaglio?.codiceProfilo ?? null,
        tipo_registro: dettaglio?.tipoRegistro ?? null,
        numero_progressivo: dettaglio?.numeroProgressivo ?? null,
        numero_documento: dettaglio?.numeroDocumento ?? null,
      };
    });
    const { error: linkError } = await admin
      .schema("vettori")
      .from("spedizioni_documenti")
      .upsert(legamiDaInserire, { onConflict: "spedizione_id,id_documento" });
    if (linkError) throw new Error(linkError.message);

    const { data: corrente, error: correnteError } = await admin
      .schema("vettori")
      .from("spedizioni")
      .select("id,direzione,vettore_id,numero_riferimento,numero_riferimento_norm,data_documento,controparte_codice,controparte_nome,zona_cap,zona_provincia,fonte_zona,porto_codice,porto_descrizione,a_nostro_carico,colli_bolla,peso_bolla,origine,campi_forzati,congelata")
      .eq("id", spedizioneId)
      .single();
    if (correnteError) throw new Error(correnteError.message);

    if (corrente.congelata) {
      const differenze = differenzeGestionali(corrente, valori);
      if (Object.keys(differenze).length === 0) {
        differenze.arrivo_documento = {
          spedizione: "valori congelati conservati",
          gestionale: "documento collegato dopo il controllo",
        };
      }
      const adesso = new Date().toISOString();
      const { error: scostamentoError } = await admin
        .schema("vettori")
        .from("spedizioni_scostamenti")
        .upsert(
          idDocumenti.map((idDocumento) => ({
            spedizione_id: spedizioneId,
            id_documento: idDocumento,
            differenze,
            aggiornato_il: adesso,
          })),
          { onConflict: "spedizione_id,id_documento,tipo" }
        );
      if (scostamentoError) throw new Error(scostamentoError.message);
      continue;
    }

    const forzati = campiForzatiDaDb(corrente.campi_forzati);
    const aggiornamento = {
      ...valori,
      origine: corrente.origine,
      aggiornata_il: new Date().toISOString(),
    };
    for (const campo of CAMPI_BOLLA_FORZABILI) {
      if (forzati[campo]) aggiornamento[campo] = valoreRiga(corrente, campo);
    }
    if (forzati.numero_riferimento) {
      aggiornamento.numero_riferimento_norm = corrente.numero_riferimento_norm;
    }
    const { error: updateError } = await admin
      .schema("vettori")
      .from("spedizioni")
      .update(aggiornamento)
      .eq("id", spedizioneId);
    if (updateError) throw new Error(updateError.message);
  }
}
