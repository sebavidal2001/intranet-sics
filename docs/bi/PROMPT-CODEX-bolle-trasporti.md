# Per Codex — estrazione bolle e dati di trasporto dal gestionale

> Data: 5 settembre 2026 · rev. 1
> Ambito: **sola lettura** sul server SQL Anywhere `SRVWOA` (192.168.1.110).
> Nessuna modifica a `config.json`, a `Invoke-BIPipeline.ps1`, agli scheduler,
> alle sette query commerciali, ai PBIX o al PostgreSQL locale.
> Le estrazioni finiscono in una cartella di laboratorio, non nel flusso notturno.
>
> Base di partenza: il pacchetto `PACCHETTO_CLAUDE_VALUTAZIONE.zip` del 5 settembre
> (dizionario 214 colonne testata + 184 riga, campione 200 bolle cliente,
> `QUERY_CANDIDATA_BOLLE.sql`). I join principali sono già risolti lì e vanno riusati.

---

## 1. A cosa serve

Stiamo quotando un modulo dell'intranet per il **controllo delle fatture dei vettori**
(GLS, TNT, FedEx, Trading Post). Il modulo deve sapere, prima che arrivi la fattura,
quali spedizioni ci si aspetta e con quali dati: numero bolla, data, controparte,
destinazione, vettore, colli, peso, porto.

L'estrazione serve a due cose distinte:

1. **Riconciliare** ogni riga di fattura del vettore con la sua bolla.
2. **Determinare la zona tariffaria** (CAP/provincia) per ricalcolare il costo atteso.

Questa fase è di verifica e collaudo: si estrae in laboratorio, si guarda il CSV,
e **solo dopo** si decide se e come agganciarlo alla pipeline.

---

## 2. Quello che sappiamo già — non rifarlo

Conteggi ricavati dal campione di 200 bolle cliente (`39_bolle_cliente_testata_top200.csv`),
tutte `tipo_registro = 'DV'`, registrate dal 3 agosto 2026 in poi.

| Campo | Copertura | Conseguenza |
|---|---:|---|
| `num_colli` | 194/200 (97%) | utilizzabile |
| `peso_lordo` | 184/200 (92%) | utilizzabile |
| `peso_netto` | 117/200 (58%) | i due pesi si riempiono a rotazione: **servono entrambi** |
| `data_trasporto` | 149/200 (74%) | utilizzabile con riserva |
| `id_sog_commerciale_vettore` | 92/200 (46%) | non filtrarci sopra |
| `id_destinazione` | 72/200 (36%) | va risolto con join |
| `dest_cap` / `dest_provincia` in chiaro | 2/200 (1%) | praticamente inutilizzabile da solo |
| `volume` | **0/200** | mai compilato |
| `num_pallet` | **0/200** | mai compilato |
| `lettera_di_vettura`, `brt_num_progr_tracking`, `autista`, `mezzo_trasporto`, `targa_mezzo_trasporto` | 0/200 | esclusi dal tracciato |
| `id_sog_commerciale_vettore_2` e `_3` | 0/200 | esclusi dal tracciato |

`tipo_trasporto` è compilato **200/200** e assume tre soli valori:

| Codice | Descrizione | Righe | Significato |
|---|---|---:|---|
| `02` | ASSEGNATO | 166 | paga il cliente: non deve comparire nelle nostre fatture vettore |
| `03` | F.CO ADDEB.FT | 17 | paghiamo noi e riaddebitiamo al cliente |
| `01` | FRANCO | 17 | paghiamo noi e non riaddebitiamo |

Incrociando porto e vettore: le bolle a nostro carico con vettore indicato sono
**16 Trading Post e 1 GLS**. BRT, DHL, Trascoop, Amadei, Italiansped e Autotrasporti RDM
compaiono **solo** in porto assegnato, cioè sono vettori dei clienti.

Sulle bolle cliente `num_documento` coincide con `num_progressivo` in **199 casi su 200**:
sulle uscite non porta informazione aggiuntiva.

Nelle 500 righe articolo del campione **non esiste nessun articolo di trasporto o spese**:
il riaddebito non è sulla bolla. `documento.val_spese` sulle bolle vale 0,77 · 1,11 · 6,21 €,
cifre incompatibili con un trasporto da 15-16 €.

> [!warning] Il buco del pacchetto
> Il campione è **interamente `tipo_registro = 'DV'`**. Delle bolle fornitore (profilo `BF`,
> 6.723 testate dal 2024) non c'è una sola riga. Sono la metà grossa del progetto:
> gli arrivi da fornitore sono ~55 spedizioni GLS al mese contro 28 partenze in tutto l'anno.

---

## 3. Fase A — quattro verifiche, prima di tutto il resto

Sono `SELECT` da pochi secondi e le loro risposte cambiano il tracciato. **Falle girare
e mandami gli output prima di scrivere l'estrazione definitiva.**

### A1 — Come si chiamano i carichi fornitore

```sql
SELECT DISTINCT tipo_registro, codice_profilo, descrizione_profilo, count(*) AS documenti
FROM dba.documento
WHERE codice_profilo IN ('BF','BFT','BFR')
   OR lower(descrizione_profilo) LIKE '%fornitor%'
GROUP BY tipo_registro, codice_profilo, descrizione_profilo
ORDER BY documenti DESC;
```

Dalla schermata del gestionale il documento si intitola *«Bolla-DDT DA»*, quindi
`tipo_registro` è verosimilmente `'DA'`. **Verificalo, non assumerlo.**

### A2 — La domanda più importante del progetto

Sui carichi fornitore, `num_documento` contiene il **numero di DDT del fornitore**?

```sql
SELECT TOP 50
       d.id_documento, d.num_progressivo, d.num_documento,
       d.data_documento, d.data_registrazione,
       an.rag_soc_1 AS fornitore
FROM dba.documento d
LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = d.id_sog_commerciale
LEFT OUTER JOIN dba.anagrafica     an  ON an.id_anagrafica      = sc.id_anagrafica
WHERE d.codice_profilo = 'BF' AND d.data_registrazione >= '2026-01-01'
ORDER BY d.data_registrazione DESC;
```

E la copertura complessiva:

```sql
SELECT count(*) AS carichi,
       sum(CASE WHEN d.num_documento IS NOT NULL AND d.num_documento <> ''
                 AND d.num_documento <> cast(d.num_progressivo AS varchar(20))
                THEN 1 ELSE 0 END) AS con_riferimento_proprio
FROM dba.documento d
WHERE d.codice_profilo = 'BF' AND d.data_registrazione >= '2026-01-01';
```

**Perché conta.** GLS e Trading Post, sulle spedizioni in arrivo, fatturano citando
il numero di DDT **del fornitore**, non il nostro numero di carico. Esempi reali dalle
fatture: GLS colonna `BDA` con valori `764`, `2694`, `6628`, `DDT26-0818`; Trading Post
colonna *Riferimenti Mittente* con `2113`, `260020147`, `8894`.

- Se quel numero è in `num_documento`, l'aggancio automatico degli arrivi funziona.
- Se non c'è, resta l'abbinamento proposto per data + fornitore + peso, con conferma
  manuale, e una scheda dello studio va riscritta.

### A3 — Copertura dei dati di trasporto sui carichi fornitore

Le percentuali della sezione 2 valgono **solo per le vendite**. Ripeti il conteggio
sugli arrivi:

```sql
SELECT d.codice_profilo, year(d.data_registrazione) AS anno, count(*) AS documenti,
       sum(CASE WHEN d.num_colli  > 0 THEN 1 ELSE 0 END) AS con_colli,
       sum(CASE WHEN d.peso_netto > 0 THEN 1 ELSE 0 END) AS con_peso_netto,
       sum(CASE WHEN d.peso_lordo > 0 THEN 1 ELSE 0 END) AS con_peso_lordo,
       sum(CASE WHEN d.volume     > 0 THEN 1 ELSE 0 END) AS con_volume,
       sum(CASE WHEN d.id_sog_commerciale_vettore IS NOT NULL THEN 1 ELSE 0 END) AS con_vettore,
       sum(CASE WHEN d.id_tipo_trasporto IS NOT NULL THEN 1 ELSE 0 END) AS con_tipo_trasporto
FROM dba.documento d
WHERE d.codice_profilo = 'BF' AND d.data_registrazione >= '2025-01-01'
GROUP BY d.codice_profilo, year(d.data_registrazione)
ORDER BY 2;
```

### A4 — La data di consegna esiste?

```sql
SELECT count(*) AS bolle,
       sum(CASE WHEN d.data_consegna_cliente IS NOT NULL THEN 1 ELSE 0 END) AS con_data_consegna,
       sum(CASE WHEN d.data_prev_consegna    IS NOT NULL THEN 1 ELSE 0 END) AS con_data_prevista
FROM dba.documento d
WHERE d.tipo_registro = 'DV' AND d.data_registrazione >= '2026-01-01';
```

Se `data_consegna_cliente` è compilata, i tempi reali di consegna per vettore e zona
si ricavano dallo storico invece di doverli chiedere ai vettori.

---

## 4. Fase B — estrazione principale: testate documenti di trasporto

Una riga per **testata**. Le righe articolo non servono e non vanno estratte.

I nomi di colonna qui sotto sono quelli reali del dizionario. I `<...>` sono gli unici
punti da risolvere sul database: **non inventare nomi plausibili**, e se un campo non
esiste dillo invece di sostituirlo con un equivalente.

```sql
SELECT
  /* identità */
  d.id_documento, d.tipo_registro, d.codice_profilo, d.descrizione_profilo,
  d.num_progressivo, d.num_documento,
  d.data_documento, d.data_registrazione, d.data_creazione,

  /* stato — da esporre, non da filtrare */
  d.stampato, d.contabilizzato, d.sospeso, d.bloccato,

  /* controparte: cliente sulle uscite, fornitore sugli arrivi */
  sc.id_sog_commerciale, sc.codice AS codice_soggetto, an.rag_soc_1 AS soggetto,
  an.<partita_iva>  AS soggetto_piva,
  an.<cap>          AS soggetto_cap,
  an.<localita>     AS soggetto_localita,
  an.<provincia>    AS soggetto_provincia,

  /* destinazione: tre fonti, tutte necessarie */
  d.id_destinazione,
  de.<rag_soc>   AS dest_denominazione_cod,
  de.<cap>       AS dest_cap_cod,
  de.<localita>  AS dest_localita_cod,
  de.<provincia> AS dest_provincia_cod,
  d.dest_rag_soc, d.dest_indirizzo, d.dest_cap, d.dest_localita, d.dest_provincia,
  d.provincia_destinazione,

  /* trasporto */
  d.id_tipo_trasporto, tt.codice AS tipo_trasporto_codice, tt.descrizione AS tipo_trasporto,
  d.id_caus_trasporto, ct.codice AS causale_trasporto_codice, ct.descrizione AS causale_trasporto,
  d.tras_mezzo, d.asp_beni,
  d.id_sog_commerciale_vettore, v.codice AS vettore_codice, av.rag_soc_1 AS vettore,

  /* quantità */
  d.num_colli, d.num_pallet, d.peso_netto, d.peso_lordo, d.volume,
  d.id_unita_misura_peso,   ump.<codice> AS um_peso,
  d.id_unita_misura_volume, umv.<codice> AS um_volume,
  d.val_spese,

  /* date */
  d.data_trasporto, d.data_prev_consegna, d.data_consegna_cliente,

  /* note ripulite */
  d.note_spedizione

FROM dba.documento d
LEFT OUTER JOIN dba.sog_commerciale sc  ON sc.id_sog_commerciale = d.id_sog_commerciale
LEFT OUTER JOIN dba.anagrafica      an  ON an.id_anagrafica      = sc.id_anagrafica
LEFT OUTER JOIN dba.tipo_trasporto  tt  ON tt.id_tipo_trasporto  = d.id_tipo_trasporto
LEFT OUTER JOIN dba.caus_trasporto  ct  ON ct.id_caus_trasporto  = d.id_caus_trasporto
LEFT OUTER JOIN dba.sog_commerciale v   ON v.id_sog_commerciale  = d.id_sog_commerciale_vettore
LEFT OUTER JOIN dba.anagrafica      av  ON av.id_anagrafica      = v.id_anagrafica
LEFT OUTER JOIN dba.<destinazione>  de  ON de.id_destinazione    = d.id_destinazione
LEFT OUTER JOIN dba.<unita_misura>  ump ON ump.<id_unita_misura> = d.id_unita_misura_peso
LEFT OUTER JOIN dba.<unita_misura>  umv ON umv.<id_unita_misura> = d.id_unita_misura_volume

WHERE d.data_registrazione >= '2026-01-01'
  AND ( d.tipo_registro = 'DV' OR d.codice_profilo = 'BF' )

ORDER BY d.data_registrazione, d.id_documento;
```

Dopo A1, se il `tipo_registro` degli arrivi risulta `'DA'`, sostituisci la condizione con
`d.tipo_registro IN ('DV','DA')`, che è più pulita e non dipende dal singolo profilo.

### Regole del `WHERE` — sono la parte in cui si sbaglia

- **Nessun filtro su `id_sog_commerciale_vettore`.** È compilato al 46% sulle vendite e
  probabilmente meno sugli arrivi: filtrarci sopra fa sparire proprio le righe che servono.
- **Nessun filtro su `tipo_trasporto`.** Il filtro sul porto lo applichiamo a valle,
  con i dati sotto gli occhi.
- **Nessun filtro sugli stati.** `sospeso`, `bloccato`, `stampato`, `contabilizzato`
  vanno esposti come colonne: vogliamo vedere quanti documenti anomali ci sono prima
  di decidere di escluderli.
- Classifica per `tipo_registro` e **tieni `codice_profilo` come dato, non come filtro**:
  nel campione compare già un `CARDEP3` dentro `DV` che non è una bolla di vendita
  ordinaria, e va visto per poterlo decidere.
- Il volume è di partenza 2026 perché serve anche a importare lo storico dell'anno.
  Se il conteggio risulta gestibile, alza a `>= '2025-01-01'` e dimmelo.

### Perché tre fonti per la destinazione

`id_destinazione` è valorizzato nel 36% dei casi, `dest_cap` in chiaro nell'1%.
Senza CAP o provincia non si determina la zona tariffaria, e senza zona non funzionano
né il controllo né il simulatore. Servono quindi, in ordine di precedenza:
destinazione codificata → destinazione in chiaro sulla testata → sede della controparte
in anagrafica.

**Sugli arrivi la zona è la provenienza**, cioè l'indirizzo del fornitore: per quello
servono `an.<cap>`, `an.<localita>`, `an.<provincia>` e non solo la ragione sociale.

---

## 5. Fase C — anagrafica dei vettori

Estrazione piccola e una tantum: serve a mappare i codici (`VT010005`) sui listini
senza scrivere tabelle di conversione a mano.

```sql
SELECT sc.id_sog_commerciale, sc.codice, an.rag_soc_1,
       an.<partita_iva>, an.<cod_fiscale>,
       an.<indirizzo>, an.<cap>, an.<localita>, an.<provincia>,
       an.<email>, an.<telefono>
FROM dba.sog_commerciale sc
JOIN dba.anagrafica an ON an.id_anagrafica = sc.id_anagrafica
WHERE sc.id_sog_commerciale IN (
        SELECT DISTINCT id_sog_commerciale_vettore
        FROM dba.documento
        WHERE id_sog_commerciale_vettore IS NOT NULL
          AND data_registrazione >= '2025-01-01'
      )
ORDER BY sc.codice;
```

---

## 6. Fase D — dove sta il riaddebito al cliente

Il riaddebito del trasporto non è sulla bolla (verificato: zero articoli di trasporto
su 500 righe campione). Sta sulla **fattura cliente**. Prima di scrivere l'estrazione
serve sapere quali articoli sono:

```sql
SELECT a.codice AS codice_articolo, rd.descrizione,
       count(*) AS righe, sum(rd.tot_riga_val_az) AS totale
FROM dba.documento d
JOIN dba.riga_documento rd ON rd.id_documento = d.id_documento
LEFT OUTER JOIN dba.articolo a ON a.id_articolo = rd.id_articolo
WHERE d.tipo_registro = 'IV'
  AND d.data_registrazione >= '2026-01-01'
  AND ( lower(rd.descrizione) LIKE '%trasport%'
     OR lower(rd.descrizione) LIKE '%spese%'
     OR lower(rd.descrizione) LIKE '%porto%'
     OR lower(rd.descrizione) LIKE '%corrier%'
     OR lower(a.codice)       LIKE '%trasp%' )
GROUP BY a.codice, rd.descrizione
ORDER BY righe DESC;
```

Sulle righe che risultano, verifica anche se `rd.id_riga_provenienza` è valorizzato:
è il meccanismo già usato da `filiera_righe` per risalire fattura → DDT. Le spese
di piede di solito non hanno provenienza, e in quel caso l'aggancio va fatto sul
numero di DDT richiamato in fattura.

Manda l'elenco: la query definitiva la scriviamo su quello.

---

## 7. Convenzioni di output

Uniformi al Cruscotto articoli, con due correzioni emerse dal campione.

```sql
OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\LAB_TRASPORTI_<data>\trasporti_documenti.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8' WITH COLUMN NAMES;
```

- **Decimali con il punto.** Nel campione escono con la virgola (`0,5560`, `1,0000`):
  il loader si aspetta il punto. Risolvilo in query o via opzione di sessione, ma
  **decidilo adesso**, non dopo il primo caricamento sbagliato.
- **Date come `YYYY-MM-DD`.** Nel campione escono con l'orario (`2026-09-04 00:00:00.000`).
  Tagliale in query, non a valle, e non affidarti all'opzione `date_format` della
  sessione: se cambia, il caricamento si rompe in silenzio.
- **`WITH COLUMN NAMES` è ammesso** — nel pacchetto del 5 settembre ha funzionato,
  a differenza di quanto annotato sul Cruscotto. Usalo: rende affidabile
  l'`HeaderPattern` invece di lasciarlo a un'euristica sulla prima riga.
- **`note_spedizione`** è `long varchar(32767)`: `replace` di `;` e dei ritorni a capo,
  taglio a 200 caratteri. Una nota con un a capo dentro sposta tutte le colonne della riga.
- **`ORDER BY` deterministico**, come scritto sopra: senza, il confronto change-only
  a valle vede differenze che non esistono.
- **NULL come campo vuoto, mai zero.** Su peso e volume la differenza tra «zero» e
  «non compilato» è tutto il senso del controllo. Su `volume` sappiamo già che il
  gestionale rende i due casi indistinguibili: annotalo, non mascherarlo.

> [!warning] Non toccare `config.json` in questa fase
> `Invoke-BIPipeline.ps1` valida tutte le query configurate e invia **un solo** manifest
> sotto un solo `run_id`. Una query nuova aggiunta senza profilo finirebbe nel run dei
> sette dataset commerciali e l'attivazione lato database fallirebbe per numero di
> dataset: **nessuna pubblicazione commerciale, ogni notte.**
> Quando sarà il momento, il dataset avrà `"Profilo": "trasporti"` e un task pianificato
> suo, a un orario diverso dall'01:30 del commerciale. Ma non adesso: prima si guarda il CSV.
> `ExpectedColumns` va congelato **solo** dopo che i `<...>` della Fase B sono risolti.

---

## 8. Cosa consegnare

1. Gli output di **A1, A2, A3, A4** — sono la parte che serve subito.
2. L'elenco dei `<...>` risolti, e quali campi **non esistono**.
3. Il file SQL di laboratorio, non inserito in `config.json`.
4. I tre CSV: `trasporti_documenti`, `trasporti_vettori`, e l'elenco articoli della Fase D.
5. Conteggio righe per profilo e per anno, così si dimensiona la crescita.

Se una delle query è troppo pesante sul server, dillo e la restringiamo per periodo:
non lanciarla in parallelo al run commerciale.

---

## 9. Il punto singolo su cui vale la pena partire

**A2.** Se sui carichi fornitore `num_documento` contiene il numero di DDT del fornitore,
l'aggancio automatico delle spedizioni in arrivo funziona e il modulo fa quello che
promette. Se non lo contiene, cambia una scheda del preventivo — non una riga di codice.
È dieci secondi di query: falla per prima e mandami solo quella, se preferisci.
