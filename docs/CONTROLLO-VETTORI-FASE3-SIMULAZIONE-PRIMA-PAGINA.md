# Fase 3 — La Simulazione diventa la prima pagina

> Stato: migration 101 applicata a produzione e sviluppo. Restano libreria, API e interfaccia.

## Cosa cambia, e perché

Oggi la Simulazione è un calcolatore a lato: risponde «quanto costa» e non lascia traccia.
Le misure dei colli si inseriscono altrove, nella pagina Bolle, **dopo** — cioè quando nessuno
ha più motivo di farlo.

La richiesta del backoffice ribalta l'ordine, e ha ragione: chi spedisce apre lo strumento
**prima**, per decidere il vettore. In quel momento ha davanti i colli, il metro e l'indirizzo.
Se il volumetrico si inserisce lì, si inserisce; se si rimanda alla pagina dopo, non si inserisce mai.

Quindi: la simulazione raccoglie le misure perché servono a lei, e alla conferma le consegna
alla bolla. Il dato che serve al controllo fatture arriva come sottoprodotto di un lavoro che
qualcuno fa comunque.

## Le cinque richieste

| # | Richiesta | Dove si risolve |
|---|---|---|
| 1 | Simulazione come primissima pagina | redirect `/vettori` + ordine sidebar |
| 2 | Assegnare il volumetrico alle bolle dalla simulazione | conferma → `crea_bolla_manuale` |
| 3 | Più colli con dimensioni diverse | `GruppoColli[]`, già supportato dal motore di calcolo |
| 4 | CAP al posto della provincia | `vettori.cap_province` + `risolvi_cap` |
| 5 | Quanto addebitare al cliente | `vettori.riaddebito_scaglioni`, resa configurabile |

## Quello che c'era già, e non va rifatto

Tre cose sono emerse leggendo il codice prima di scrivere, e cambiano la dimensione del lavoro:

- **Il motore di calcolo sa già fare i colli disomogenei.** `pesoVolumetrico()` in
  `src/lib/portali/vettori/calcolo.ts` somma `dati.misureColli[]` da sempre. Manca solo che
  l'interfaccia e la rotta `/api/portali/vettori/simula` glieli passino: oggi la rotta accetta
  una sola terna L/P/H.
- **La tabella delle tariffe di riaddebito esiste dalla migration 087** ed è popolata dalla 088
  con i valori 2026 (16,50 / 22,50 / 31,00 / 49,00, oltre 100 kg «chiedere offerta»). Non era
  mai stata collegata a niente: zero riferimenti nel codice.
- **Il CAP arriva già dal gestionale.** `soggetto_cap` è compilato su 1.882 bolle su 1.883 e la
  pipeline lo porta in `vettori.spedizioni.zona_cap`.

## La tabella CAP, e come è stata verificata

Fonte: ISTAT + ANCI (dataset `comuni-json`, 7.904 comuni, 4.678 CAP distinti).

Non è stata caricata sulla fiducia. Il controllo: estrarre le 210 coppie CAP/provincia che
compaiono davvero nelle nostre bolle e chiedere alla tabella di riprodurle.

| Esito | Righe |
|---|---|
| Risolte esattamente | 207 |
| Riconosciute estere (San Marino) | 1 |
| Non risolte (Germania, Paesi Bassi) | 2 |
| **In contraddizione** | **0** |

Tre cose che il controllo ha fatto emergere, e che sono nel codice:

> [!warning] Il prefisso da solo sceglierebbe il vettore sbagliato
> Su 205 prefissi a tre cifre, 194 puntano a una sola provincia. Ma **12071** sta a cavallo fra
> Cuneo e Savona e **18025** fra Cuneo e Imperia — e Cuneo è dentro l'area Trading Post mentre
> la Liguria no. Per questo la tabella è esatta CAP per CAP, e il prefisso resta un ripiego
> **dichiarato**: `fonte: "prefisso"`, `certo: false`.

> [!warning] San Marino sarebbe uscito tariffato come Rimini
> 47896 (Faetano) non è nell'elenco ANCI e il prefisso 478 dà RN. Sono tre bolle nostre, e
> sarebbe stata una quotazione internazionale presentata come nazionale. I dieci CAP 4789x sono
> marcati `estero`. **Il Vaticano no**: 00120 è nell'elenco come Roma e i vettori lo consegnano
> come Roma.

> [!info] Il seed dai nostri dati importava anche i nostri errori
> Fra le province delle nostre bolle compaiono `D` (Aldingen, Germania), `ZB` (Breukelen) e
> `RSM`. Il seed accetta ora solo sigle esistenti. Resta dentro **80841 Carate Brianza**, che è
> un refuso del gestionale per 20841 ripetuto su 18 bolle: la provincia è comunque giusta, e chi
> ricopia quel CAP dall'anagrafica trova la risposta corretta.

## Contratto — da rispettare alla lettera

I tipi sono già in `src/lib/portali/vettori/tipi.ts` (commit `c3cc1a0`) e **non vanno modificati**:
`FonteProvincia`, `EsitoCap`, `GruppoColli`, `BasePesoRiaddebito`, `ScaglioneRiaddebito`,
`AccordoRiaddebitoCliente`, `VersioneRiaddebito`, `EsitoRiaddebito`, `EsitoSimulazione`,
`RispostaSimulazione`, `ConfermaSimulazione`.

### `POST /api/portali/vettori/simula`

```jsonc
{
  "direzione": "uscita",              // default "uscita"
  "cap": "20121",                     // opzionale
  "provincia": "MI",                  // usata se il CAP non basta o manca
  "controparteCodice": "C001234",     // opzionale: attiva l'accordo cliente
  "colli": 3,
  "pesoKg": 42.5,
  "gruppi": [                         // opzionale, ma è la strada normale
    { "quantita": 2, "lunghezzaCm": 120, "larghezzaCm": 80, "altezzaCm": 100 },
    { "quantita": 1, "lunghezzaCm": 40,  "larghezzaCm": 30, "altezzaCm": 25 }
  ],
  "lunghezzaCm": null, "larghezzaCm": null, "altezzaCm": null,  // compatibilità
  "data": "2026-09-12",
  "condizioni": ["bancale"]
}
```

Risposta: `RispostaSimulazione`.

Regole:
- Se `cap` c'è, si chiama `vettori.risolvi_cap`. Con `certo: true` si usa quella provincia e
  `fonteProvincia: "cap"`. Con `estero: true` **nessun vettore è disponibile**: motivo
  «destinazione internazionale, serve una quotazione a parte».
- Con più province o nessun risultato: se il chiamante ha passato `provincia`, si usa quella
  (`fonteProvincia: "manuale"`); altrimenti si popola `capDaChiarire` e si risponde comunque con
  i vettori calcolati sulla zona di ripiego, dichiarandolo.
- `fonte: "prefisso"` → `fonteProvincia: "prefisso"`, e il campo va mostrato.
- `colli` deve coincidere con la somma delle `quantita` dei gruppi. Se non coincide: 400, con il
  messaggio che dice i due numeri. Non correggere in silenzio.

### `GET /api/portali/vettori/cap/[cap]` → `EsitoCap | null`

Per la risoluzione mentre si digita. 404 quando non risolve.

### `POST /api/portali/vettori/simulazioni` → `ConfermaSimulazione`

```jsonc
{
  "simulazione": { /* gli stessi input della simula, più */ "vettoreSceltoId": "uuid",
                   "costoPrevisto": 31.4, "riaddebitoPrevisto": 49.0,
                   "esiti": [ /* EsitoSimulazione[] così come restituiti */ ] },
  "bolla": {
    "numeroRiferimento": "BF-9001",   // null = «lo inserisco dopo»
    "dataDocumento": "2026-09-12",
    "controparteNome": "Cliente Alfa",
    "controparteCodice": null
  }
}
```

Scrive `vettori.simulazioni`, poi chiama `crea_bolla_manuale` con `origine: "simulazione"`,
i gruppi come `misure` e `fonte_misure: "manuale"`. Senza numero la spedizione nasce
`stato: "da_numerare"`, ed è la RPC a deciderlo — non passare `stato` dall'applicazione.

> [!warning] Il duplicato è il rischio vero di questa funzione
> Quando il gestionale porta la stessa bolla, `sincronizzaSpedizioniGestionali` la ritrova per
> `(direzione, numero_riferimento_norm, data_documento)` e la fonde. **Se la data non coincide,
> nascono due spedizioni** e le misure restano attaccate a quella sbagliata.
> Prima di creare, cercare una spedizione con la stessa terna: se esiste, agganciare le misure a
> quella invece di crearne una nuova, e restituire il suo id.

### `GET|POST /api/portali/vettori/riaddebito`

`GET` → `{ versione: VersioneRiaddebito, accordi: AccordoRiaddebitoCliente[] }`, solo
`amministrazione`. `POST` con `{ validoDal, basePeso, scaglioni }` chiama
`vettori.salva_riaddebito_scaglioni`. Un secondo verbo gestisce gli accordi cliente.

## Il calcolo del riaddebito

`src/lib/portali/vettori/riaddebito.ts`, funzione pura come `calcolo.ts`, nessun accesso al DB:

1. Accordo cliente valido alla data? `nessun_addebito` → 0. `importo_fisso` → quello.
2. Altrimenti scaglione sul peso indicato da `basePeso` (`tassabile` = quello su cui fattura il
   vettore, quindi **diverso per vettore**; `reale` = solo la bilancia).
3. `importo` null → `EsitoRiaddebito.importo = null` con l'avvertenza. **Mai 0.**
4. `margine = importo − calcolo.totale`, `null` se l'importo manca.

> [!todo] Da confermare con chi emette gli addebiti
> `base_peso` parte da `tassabile`. Con `tassabile` lo stesso collo può dare un riaddebito
> diverso a seconda del vettore, perché cambia il divisore volumetrico (300 GLS e Trading Post,
> 250 TNT e FedEx). Con `reale` il riaddebito è uno solo ma può stare sotto il costo.
> Il campo è configurabile dalle Impostazioni proprio perché la risposta la deve dare
> l'amministrazione, non il codice.

## Interfaccia

**Simulazione** — il form diventa: destinazione (CAP con risoluzione a video, «Milano (MI)»
sotto al campo), peso totale, e un **elenco di gruppi di colli** con aggiungi/togli, ciascuno
quantità × L × P × H. Il volume e il peso volumetrico si aggiornano mentre si digita.

I risultati mostrano tre numeri per vettore: **costo nostro**, **da addebitare**, **margine**.
Il margine negativo si vede. Quando il riaddebito manca, la colonna dice «chiedere offerta» e
non 0,00.

In fondo: **Conferma e crea la bolla** → chiede numero, data, controparte, con «lo inserisco
dopo» che salva comunque.

**Bolle** — le spedizioni `da_numerare` vanno in cima con un'etichetta e un campo per il numero.
Sono la coda di chi deve tornarci sopra: in fondo all'elenco sparirebbero.

**Impostazioni** (`/vettori/listini`) — sezione riaddebito: la versione in vigore, gli scaglioni
modificabili, la data di decorrenza, la base di peso, e gli accordi per cliente.

**Redirect** — `/vettori` porta tutti alla Simulazione. Nella sidebar è la prima voce.

## Test attesi

- `riaddebito.ts`: scaglione normale, importo fisso, nessun addebito, oltre soglia senza importo
  (deve dare `null`, non 0), margine negativo.
- `cap.ts`: CAP esatto, a cavallo, per prefisso, estero, sconosciuto.
- multi-collo: due gruppi diversi contro il volume calcolato a mano.
- conferma: senza numero → `da_numerare`; con numero già esistente → aggancio, non duplicato.
