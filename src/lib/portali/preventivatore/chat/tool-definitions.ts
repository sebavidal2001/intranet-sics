// ─── Tool definitions shared between Gemini and OpenRouter handlers ───────────

export const TOOL_LIST_PREVENTIVI_DEF = {
  name: "list_preventivi",
  description:
    "Elenca preventivi dal database con filtri e ordinamento. Usare per: 'tutti i preventivi', 'preventivi di [cliente]', 'preventivi ordinati/rifiutati', 'preventivi del 2024', 'top N per importo', 'il preventivo più costoso', 'ordina per valore', 'preventivi sopra/sotto X euro', 'quanti preventivi con importo > Y', ecc. " +
    "Supporta filtri di importo (importo_min/importo_max) per query soglia. " +
    "Se l'utente chiede 'quanti preventivi sopra X €', usa importo_min=X e count_only=true. " +
    "I record restituiti includono anche le date di consegna (data_consegna_richiesta/confermata/effettiva, giorni_consegna_offerti): se l'utente chiede 'tempi di consegna' e i campi sono NULL, dichiaralo esplicitamente come 'dato non popolato' invece di dire che il campo non esiste.",
  parameters_obj: {
    cliente:      { type: "string",  description: "Nome cliente, es. ALPHAMAC" },
    stato:        { type: "string",  description: "Stato: pending, ordinato o rifiutato" },
    categoria:    { type: "string",  description: "Categoria prodotto, es. scale, nastri, protezioni, strutture" },
    anno:         { type: "number",  description: "Anno di riferimento, es. 2024" },
    importo_min:  { type: "number",  description: "Filtra preventivi con importo_preventivo >= importo_min (€)" },
    importo_max:  { type: "number",  description: "Filtra preventivi con importo_preventivo <= importo_max (€)" },
    order_by:     { type: "string",  description: "Campo: codice, importo_preventivo, importo_ordinato, data_offerta" },
    order_dir:    { type: "string",  description: "Direzione: desc (default) o asc" },
    limit:        { type: "number",  description: "Max risultati (default 50, max 200)" },
    count_only:   { type: "boolean", description: "Se true, restituisce solo il conteggio totale (no items). Usalo per 'quanti preventivi...'" },
  },
  required: [] as string[],
};

export const TOOL_CERCA_SIMILI_DEF = {
  name: "cerca_simili",
  description:
    "Ricerca semantica nei preventivi storici a livello di BLOCCO/configurazione. Ogni risultato è un singolo blocco di un preventivo (campo 'blocco') con il suo punteggio di similarità: un blocco molto simile viene trovato anche se appartiene a un preventivo grande e con importo totale diverso. Usare per 'trova configurazioni simili a quella che sto costruendo', 'a quale preventivo somiglia questo blocco', 'preventivi con motoriduttore...'. Quando l'utente sta costruendo/copiando un blocco, usa come query i CODICI ARTICOLO esatti del blocco corrente (presenti nello stato del builder), non una descrizione generica.",
  parameters_obj: {
    query:   { type: "string", description: "Codici articolo e/o descrizione tecnica da cercare semanticamente. Se l'utente sta replicando un blocco, elenca i codici articolo esatti." },
    cliente: { type: "string", description: "Filtro opzionale per cliente" },
    limite:  { type: "number", description: "Max blocchi da restituire, default 8" },
  },
  required: ["query"] as string[],
};

export const TOOL_CERCA_ARTICOLO_DEF = {
  name: "cerca_articolo",
  description:
    "Ricerca testuale nelle distinte materiali. Usare per: codici articolo (es. '4505000'), materiali (es. 'profilato alluminio 170×40'), dimensioni, n° gradini o qualsiasi testo tecnico nelle voci di preventivo.",
  parameters_obj: {
    query:              { type: "string", description: "Testo da cercare nelle distinte" },
    codice_preventivo:  { type: "string", description: "Filtro per codice preventivo (es. S_24_103)" },
    limite:             { type: "number", description: "Max preventivi da restituire, default 10" },
  },
  required: ["query"] as string[],
};

export const TOOL_AGGREGA_DEF = {
  name: "aggrega_preventivi",
  description:
    "Dati aggregati (group by) sui preventivi. Usare per: 'quanti preventivi per cliente', 'valore totale per stato', 'tasso di conferma per categoria', 'preventivi per mese', 'quale cliente ha il maggior numero di ordinati', statistiche aggregate, conteggi, somme, medie.",
  parameters_obj: {
    group_by:           { type: "string", description: "Dimensione di raggruppamento: stato | cliente | categoria | anno | mese" },
    metrica:            { type: "string", description: "Metrica di ordinamento: count (default) | sum_importo | avg_importo | tasso_ordinato" },
    filtro_stato:       { type: "string", description: "Filtra per stato: pending, ordinato, rifiutato" },
    filtro_cliente:     { type: "string", description: "Filtra per nome cliente (ricerca parziale)" },
    filtro_anno:        { type: "number", description: "Filtra per anno, es. 2024" },
    filtro_importo_min: { type: "number", description: "Filtra preventivi con importo_preventivo >= valore" },
    filtro_importo_max: { type: "number", description: "Filtra preventivi con importo_preventivo <= valore" },
    limit:              { type: "number", description: "Max righe nel risultato, default 20" },
  },
  required: ["group_by"] as string[],
};

export const TOOL_QUERY_RIGHE_DEF = {
  name: "query_righe_distinta",
  description:
    "Query sulla tabella strutturata delle voci distinta materiali (prezzi, codici, quantità). " +
    "Usare per: 'codice con prezzo unitario più alto', 'articolo più costoso', 'top 10 costi per codice', " +
    "'quanto costa il codice 4505000', 'tutti i preventivi che usano AFD.00.2.32435', 'cerca articoli con descrizione profilato'. " +
    "Modalità: max_prezzo=singola riga con prezzo massimo assoluto, top_costi=classifica per prezzo max per codice, " +
    "cerca_codice=filtra per codice articolo, cerca_descrizione=filtra per testo descrizione.",
  parameters_obj: {
    modalita:        { type: "string", description: "max_prezzo | top_costi | cerca_codice | cerca_descrizione" },
    query:           { type: "string", description: "Testo da cercare (per cerca_codice e cerca_descrizione)" },
    categoria:       { type: "string", description: "Filtra per categoria preventivi, es. scale" },
    filtro_cliente:  { type: "string", description: "Filtra per cliente" },
    filtro_stato:    { type: "string", description: "Filtra per stato preventivo" },
    limit:           { type: "number", description: "Numero max risultati, default 10" },
  },
  required: ["modalita"] as string[],
};

export const TOOL_TOP_ARTICOLI_DEF = {
  name: "top_articoli",
  description:
    "Trova gli articoli (codici) più utilizzati nei preventivi, contando in quanti documenti unici appaiono. " +
    "Usare per: 'articoli più usati', 'top 10 codici', 'materiali più ricorrenti nelle scale', 'quali articoli compaiono di più', " +
    "'componenti più frequenti', 'classifica articoli per categoria'. " +
    "Restituisce codice articolo, numero di preventivi in cui compare e una breve descrizione.",
  parameters_obj: {
    categoria:       { type: "string", description: "Categoria dei preventivi da analizzare, es. 'scale', 'ballatoi'. Se omessa analizza tutto." },
    top_n:           { type: "number", description: "Numero di articoli da restituire, default 10, max 30" },
    filtro_cliente:  { type: "string", description: "Filtra per cliente (ricerca parziale)" },
    filtro_stato:    { type: "string", description: "Filtra per stato: pending, ordinato, rifiutato" },
  },
  required: [] as string[],
};

export const TOOL_ANOMALIE_DEF = {
  name: "cerca_anomalie_importi",
  description:
    "Trova preventivi anomali per importo, ovvero quelli che si discostano significativamente dalla media storica del loro cliente+categoria. " +
    "Restituisce preventivi con z-score > 2 (molto_alto/molto_basso) o > 1 (alto/basso). " +
    "Usare per domande tipo: 'preventivi sospetti', 'preventivi fuori range', 'preventivo anomalo per ALPHAMAC', 'quali preventivi sono molto sopra media cliente'. " +
    "Restituisce: codice, cliente, categoria, importo, media_storica, z_score, classificazione.",
  parameters_obj: {
    classificazione: {
      type: "string",
      description: "Filtra per classificazione: molto_alto | alto | molto_basso | basso. Se omesso restituisce tutti con z>1.",
    },
    cliente:   { type: "string", description: "Filtra per cliente (ricerca parziale)" },
    categoria: { type: "string", description: "Filtra per categoria (scale, nastri, protezioni, ecc.)" },
    anno:      { type: "number", description: "Filtra per anno" },
    limit:     { type: "number", description: "Max risultati, default 20" },
  },
  required: [] as string[],
};

export const TOOL_DETTAGLIO_DEF = {
  name: "dettaglio_preventivo",
  description:
    "Recupera il contenuto COMPLETO di un singolo preventivo: distinta materiali con codici, quantità, prezzi, " +
    "manodopera (progettazione/lavorazione/montaggio), totali e tutti i dati tecnici. " +
    "Usare SEMPRE quando l'utente chiede: 'tutti i dati del preventivo X', 'la distinta completa di S_24/041', " +
    "'mostrami tutto il preventivo', 'dettaglio del preventivo', 'costi e quantità del preventivo X'. " +
    "Accetta il codice sia in formato S_24/041 sia S_24_041.",
  parameters_obj: {
    codice: { type: "string", description: "Codice preventivo, es. S_24/041 oppure S_24_041" },
  },
  required: ["codice"] as string[],
};

export const TOOL_ANALISI_SQL_DEF = {
  name: "analisi_preventivi_sql",
  description:
    "Esegue analisi numeriche affidabili tramite funzioni SQL dedicate nel database. " +
    "Usare per domande aggregate e confronti: statistiche per categoria/cliente/tipo prodotto, confronto anni, " +
    "top codici per valore o frequenza, analisi ricarichi, ore/tariffe lavorazioni, controllo qualita dati e preventivi incompleti. " +
    "Preferisci questo tool a calcoli manuali quando l'utente chiede numeri, classifiche, medie, totali o controlli di completezza.",
  parameters_obj: {
    modalita: {
      type: "string",
      description:
        "statistiche_categoria | statistiche_cliente | statistiche_tipo_prodotto | confronta_anni | top_codici_valore | top_codici_frequenza | analisi_ricarichi | analisi_lavorazioni | controllo_qualita | preventivi_da_completare",
    },
    anno: { type: "number", description: "Anno filtro, es. 2026" },
    anno_a: { type: "number", description: "Primo anno per confronta_anni" },
    anno_b: { type: "number", description: "Secondo anno per confronta_anni" },
    stato: { type: "string", description: "Filtro stato: pending, ordinato, rifiutato" },
    cliente: { type: "string", description: "Filtro cliente, ricerca parziale" },
    categoria: { type: "string", description: "Filtro categoria, es. nastri, protezioni, scale" },
    tipo_prodotto: { type: "string", description: "Filtro tipo prodotto" },
    group_by: { type: "string", description: "Per analisi_ricarichi: categoria | cliente | tipo_prodotto | codice_articolo" },
    limit: { type: "number", description: "Numero massimo risultati, default variabile, max gestito dal DB" },
  },
  required: ["modalita"] as string[],
};

// ─── Tool per redazione preventivi (migration 043) ───────────────────────────

export const TOOL_CERCA_ARTICOLO_ANAGRAFICA_DEF = {
  name: "cerca_articolo_anagrafica",
  description:
    "Cerca articoli nel catalogo prodotti SICS (`preventivatore.prodotti`): codice, descrizione, ult_costo, categoria, gruppo, reparto, **fornitore**, fornitore_codice. " +
    "Tutti i ~20.000 prodotti hanno fornitore popolato (471 fornitori distinti, es. 'WURTH netto', 'CBA olio compressori', 'AZ PNEUM. (PLURI) acq. 35%'). " +
    "Usare per: 'qual è il costo attuale del codice X', 'prodotti della categoria Y', 'mostra il listino', 'cerca articolo per descrizione', " +
    "'chi è il fornitore del codice X', 'tutti i prodotti del fornitore Z', 'cosa abbiamo da WURTH'. " +
    "Match codice esatto + parziale, descrizione ilike (le descrizioni contengono dimensioni/materiali/norme/tensioni, es. 'TUBO POLIAMMIDE PA12 12x10-BLU 100mt cod.nomencl. 39173200-IT'). " +
    "Per la STORIA DEL PREZZO nel tempo usa invece storia_prezzi_articolo.",
  parameters_obj: {
    codice:      { type: "string",  description: "Codice articolo (es. AFD.00.1.11191.0), match esatto + parziale" },
    descrizione: { type: "string",  description: "Testo libero da cercare nella descrizione (ilike)" },
    categoria:   { type: "string",  description: "Categoria/gruppo/cat_merc (es. nastro, scala, protezione, COMPONENTI)" },
    fornitore:   { type: "string",  description: "Filtro per nome fornitore (ilike), es. 'WURTH', 'BONFIGLIOLI', 'AIRFLUID a disegno'" },
    solo_attivi: { type: "boolean", description: "Default true: esclude prodotti dismessi" },
    limit:       { type: "number",  description: "Max risultati, default 30 max 100" },
  },
  required: [] as string[],
};

export const TOOL_LISTINO_SERVIZI_DEF = {
  name: "listino_servizi",
  description:
    "Restituisce il listino corrente dei servizi/lavorazioni configurati in `preventivatore.servizi_manodopera`: nome, categoria, tariffa_ora, unità. " +
    "Usare per: 'qual è la tariffa del MONTAGGIO?', 'quali lavorazioni abbiamo a listino?', 'costo orario LAVORAZIONE'. " +
    "Restituisce solo i servizi con is_attivo=true.",
  parameters_obj: {
    categoria: { type: "string", description: "Filtro categoria opzionale" },
  },
  required: [] as string[],
};

export const TOOL_STORIA_PREZZI_ARTICOLO_DEF = {
  name: "storia_prezzi_articolo",
  description:
    "Andamento storico del prezzo di un articolo specifico: ult_costo corrente in anagrafica + tutte le occorrenze nelle distinte storiche con prezzo_unitario, quantità, cliente, ricarico applicato. " +
    "Usare per: 'come è cambiato il costo del codice X', 'quale prezzo abbiamo applicato negli ultimi anni a Y', 'storia prezzi AFD.00.1.10036.0'. " +
    "Default ultimi 5 anni. Restituisce max 100 righe ordinate dal più recente.",
  parameters_obj: {
    codice: { type: "string", description: "Codice articolo (es. AFD.00.1.11191.0)" },
    anni:   { type: "number", description: "Quanti anni indietro guardare, default 5" },
  },
  required: ["codice"] as string[],
};

export const TOOL_ANALISI_MARGINI_DEF = {
  name: "analisi_margini",
  description:
    "Margini medi tra importo preventivato e importo ordinato (quando entrambi presenti): scostamento_pct positivo = vendita più alta del preventivo, negativo = sconto applicato dal cliente. " +
    "Include anche il ricarico_medio_distinta delle righe materiali. " +
    "Usare per: 'qual è il margine medio per CURTI?', 'su quali categorie abbiamo i margini migliori?', 'sconti tipici applicati'. " +
    "Solo i documenti che hanno entrambi gli importi entrano nel calcolo dello scostamento.",
  parameters_obj: {
    cliente:   { type: "string", description: "Filtro cliente parziale" },
    categoria: { type: "string", description: "Filtro categoria parziale" },
    anno:      { type: "number", description: "Filtro anno" },
    limit:     { type: "number", description: "Max gruppi cliente×categoria restituiti, default 50" },
  },
  required: [] as string[],
};

export const TOOL_HIT_RATE_DEF = {
  name: "hit_rate",
  description:
    "Hit-rate commerciale: per cliente×categoria, conta preventivi totali, ordinati, falliti, pending; calcola hit_rate_pct = ordinati / (ordinati+falliti) * 100. " +
    "Considera sia gli stati legacy ('ordinato'/'rifiutato') sia i workflow nuovo ('ordinata'/'fallita'). " +
    "Filtro temporale su `data_offerta` parsata. Usare per: 'qual è il nostro tasso di conversione su ALPHAMAC?', 'su quali categorie ordinano di più i clienti?', 'hit-rate ultimi 12 mesi'.",
  parameters_obj: {
    cliente:   { type: "string", description: "Filtro cliente parziale" },
    categoria: { type: "string", description: "Filtro categoria parziale" },
    mesi:      { type: "number", description: "Finestra temporale in mesi (default 24)" },
    limit:     { type: "number", description: "Max gruppi (default 30)" },
  },
  required: [] as string[],
};

export const TOOL_INFO_CLIENTE_DEF = {
  name: "info_cliente",
  description:
    "Scheda completa di un cliente: anagrafica master dal Cruscotto (codice, destinazioni/sedi, agente_codice/agente_nome) + ultimi N preventivi + stats aggregate (totale preventivi, n_ordinati, n_falliti, hit_rate_pct, valore_totale, importo_medio). " +
    "Usare per: 'parlami del cliente X', 'chi è il commerciale di Y?', 'quanti preventivi abbiamo per ALPHAMAC?', 'ultime commesse di CURTI'. " +
    "Match parziale sulla ragione sociale (ilike).",
  parameters_obj: {
    ragione:           { type: "string", description: "Nome cliente (anche parziale, es. IMA, ALPHA)" },
    limit_preventivi:  { type: "number", description: "Quanti preventivi recenti includere (default 8)" },
  },
  required: ["ragione"] as string[],
};

export const TOOL_ARTICOLI_ASSOCIATI_DEF = {
  name: "articoli_associati",
  description:
    "Market basket: dato un codice articolo, restituisce gli altri codici che appaiono SPESSO nello stesso preventivo (stesso documento_id), ordinati per frequenza. " +
    "Usare per suggerimenti distinta: 'cosa metto solitamente insieme al codice X?', 'articoli che vanno con AFD.00.1.10036.0'. " +
    "Restituisce codice, descrizione tipica, frequenza assoluta e percentuale di associazione (frequenza / documenti che contengono il codice).",
  parameters_obj: {
    codice:    { type: "string", description: "Codice articolo target" },
    min_freq:  { type: "number", description: "Frequenza minima (default 2)" },
    limit:     { type: "number", description: "Max suggerimenti (default 20)" },
  },
  required: ["codice"] as string[],
};

export const TOOL_TREND_MENSILE_DEF = {
  name: "trend_mensile",
  description:
    "Serie mensile dei preventivi degli ultimi N mesi: per ogni mese conta preventivi, valore_totale, ordinati. " +
    "Espone direttamente la RPC dashboard_serie_mensile_categoria. " +
    "Usare per: 'qual è il trend mensile?', 'in quale mese facciamo più preventivi?', 'serie storica 2025 per categoria nastri'.",
  parameters_obj: {
    months:    { type: "number", description: "Quanti mesi a ritroso (default 12, max 36)" },
    categoria: { type: "string", description: "Filtro categoria opzionale" },
  },
  required: [] as string[],
};

// ─── Fallback constants (used if the row is missing in ai_config) ─────────────

export const SICS_KNOWLEDGE_FALLBACK =
  "=== PROFILO AZIENDA SICS ===\n" +
  "Ragione sociale: SICS by Airfluid s.r.l.\n" +
  "Sede: Via Fornace 26, Castel Guelfo (BO) 40023, Italia | Tel: +39 0542 670840 | info@s-ics.com | www.s-ics.com\n" +
  "P.IVA: 00683421200 | Fondata: 1990 (35+ anni di esperienza)\n" +
  "Claim aziendale: 'Create to Solve'\n" +
  "Certificazione: ISO 9001:2024\n" +
  "Valori fondamentali: Passione, Ingegno, Fiducia, Determinazione, Responsabilità, Crescita\n" +
  "\n" +
  "SETTORI SERVITI: alimentare/beverage, farmaceutico, automotive, logistica e magazzino, manifatturiero generale, chimico/petrolchimico, elettronica, imballaggio.\n" +
  "\n" +
  "GAMMA PRODOTTI:\n" +
  "1. TRASPORTATORI (9 tipologie): nastri piani, nastri inclinati, nastri a curva, trasportatori a catena, a cerniera/lamiera, a rete metallica, elevatori a tazze, trasportatori vibranti, sistemi di accumulo/buffer.\n" +
  "2. PROTEZIONI (3 tipologie): recinzioni modulari di sicurezza, ripari fissi (carter, schermi), tunnel e cabine di protezione.\n" +
  "3. TELAI: strutture portanti in alluminio e acciaio, frame modulari per linee produttive.\n" +
  "4. SCALE E PIATTAFORME: scale fisse industriali a norma, scalette di accesso, ballatoi e passerelle, piattaforme di lavoro sopraelevate.\n" +
  "5. SMART PRODUCTION (4 prodotti): sistemi di monitoraggio produzione in tempo reale, sensori IoT per linee, dashboard analytics, integrazione MES/ERP.\n" +
  "6. AUTOMAZIONI (3 tipologie): manipolatori e pick&place, sistemi di presa/rilascio robotizzati, celle automatizzate integrate.\n" +
  "7. IMPIANTI BORDO MACCHINA (4 tipi): alimentatori automatici, scaricatori, sistemi di orientamento/posizionamento pezzi, buffer di accumulo bordo linea.\n" +
  "8. IMPIANTI CAPANNONE: rulliere di smistamento, sistemi di stoccaggio automatico, logistica interna e movimentazione.\n" +
  "9. COMPONENTI (7 categorie): pneumatica (cilindri, valvole, raccordi), vuoto (ventose, generatori, pompe), elettromeccanica (motoriduttori, variatori, encoder), lubrificazione (sistemi centralizzati, dosatori), strutture (profilati alluminio, connettori), fluidi (tubi, raccordi, filtri), materiali di consumo (cinghie, guarnizioni, rulli).\n" +
  "10. SERVIZI (10 tipologie): progettazione su misura, revisione e retrofit impianti esistenti, manutenzione preventiva e correttiva, installazione e collaudo, formazione operatori, consulenza tecnica, assistenza tecnica remota e on-site, fornitura ricambi, sviluppo software/automazione, audit di sicurezza macchinari.\n" +
  "\n" +
  "PUNTI DI FORZA: soluzioni custom ingegnerizzate internamente, tempi di consegna rapidi, supporto post-vendita strutturato, forte know-how su integrazione di sistemi eterogenei, approccio 'chiavi in mano' dalla progettazione al collaudo.\n" +
  "=== FINE PROFILO AZIENDA ===\n\n";

export const PRECISO_FALLBACK =
  "MODALITÀ PRECISO: riporta ESCLUSIVAMENTE dati presenti nei preventivi trovati — codici, quantità, prezzi, ore — senza aggiungere interpretazioni, suggerimenti o osservazioni non documentate. Se un'informazione non è in archivio, dì esplicitamente che non è disponibile. Quando rispondi a domande generali (definizioni, spiegazioni tecniche non legate all'archivio), specifica brevemente 'questa è conoscenza generale, non dall'archivio SICS' e offri di cercare dati concreti nel DB. Sii conciso e diretto. ";

export const CREATIVO_FALLBACK =
  "MODALITÀ CREATIVO: usa i dati dell'archivio come base solida, poi aggiungi ragionamento commerciale di valore: identifica pattern tra preventivi ordinati e rifiutati, segnala rischi di pricing, suggerisci componenti o lavorazioni che aumentano il tasso di conferma, fai osservazioni sul tipo di cliente, proponi un posizionamento di prezzo motivato. Distingui chiaramente i dati certi (dall'archivio) dalle tue osservazioni (ragionamento induttivo). ";
