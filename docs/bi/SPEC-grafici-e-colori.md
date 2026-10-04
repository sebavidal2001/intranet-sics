# Spec: sei grafici nuovi + colore per serie

## Parte A — Colore scelto per serie

Oggi `SerieAnalisi` (src/lib/prototipo-bi/tipi.ts:274) e' `{ruolo, nome, spec}`.
I primitivi accettano gia' un `colore?: string` opzionale per serie
(primitivi.tsx:561, 614-615), ma nessuno lo passa: il colore viene sempre da
`coloreSerie(i)` della palette.

1. Aggiungere a `SerieAnalisi` il campo opzionale `colore?: string`
   (esadecimale `#rrggbb`). Opzionale: assente = colore della palette per
   posizione, che resta il comportamento di default.
2. `GraficoDaAnalisi` in grafico-da-risultato.tsx deve inoltrare
   `serie[i].colore` ai primitivi che lo accettano (linee, combo, barre,
   areeImpilate). Dove il primitivo non ha ancora il parametro, aggiungerlo con
   lo stesso schema `colore ?? coloreSerie(i)`.
3. Nell'editor (editor-analisi.tsx), nella scheda "Confronta con…" dove si
   compongono le serie, ogni serie ha un selettore di colore: gli 8 colori
   della palette attiva come pastiglie cliccabili piu' un `<input type="color">`
   per un colore libero, e un pulsante "Automatico" che rimette `undefined`.
   Il selettore mostra quale colore e' attivo.
4. La spec salvata (`analisi.serie jsonb`) porta con se' il colore: nessuna
   migration serve, il campo e' dentro il jsonb.
5. Validare in scrittura: il route POST/PUT /api/bi/analisi deve rifiutare un
   `colore` che non sia `/^#[0-9a-fA-F]{6}$/`. Il colore finisce in un
   attributo SVG `fill`/`stroke`: una stringa arbitraria la' dentro e' un
   vettore, non solo un errore estetico.

## Parte B — Sei tipi di grafico nuovi

Aggiungere a `TipoGrafico` (scelta-grafico.ts:23): `matrice`, `pendenza`,
`distribuzione`, `posizioni`, `flusso`, `istogramma`.
Nomi italiani, come tutti gli altri identificatori del progetto.

| chiave | cos'e' | forma del dato richiesta |
|---|---|---|
| `matrice` | tabella pivot: righe = dim 1, colonne = dim 2, celle = valore, con totali di riga e colonna | esattamente 2 raggruppamenti |
| `pendenza` | slope chart: due soli periodi a confronto, una retta per categoria, evidenzia chi sale e chi scende | 1 raggruppamento + esattamente 2 punti temporali |
| `distribuzione` | box plot: mediana, quartili, baffi, valori fuori scala, uno per categoria | 1 raggruppamento + granularita' (serve una distribuzione per categoria) |
| `posizioni` | bump chart: come cambia la CLASSIFICA nel tempo, non il valore | 1 raggruppamento + granularita', >= 3 periodi |
| `flusso` | sankey a stadi: quanto passa da uno stadio al successivo | dati a imbuto: 1 raggruppamento ordinato, valori decrescenti |
| `istogramma` | frequenze: quante righe cadono in ogni fascia di valore | nessun raggruppamento richiesto, si costruisce sui valori delle righe |

Regole:
- ogni grafico nuovo va in `src/components/prototipo-bi/grafici-nuovi.tsx`
  (file nuovo), stesso idioma dei grafici esistenti in `grafici-avanzati.tsx`:
  SVG a mano, `useImpostazioni()` per palette/densita'/animazioni, nessuna
  libreria di charting aggiunta.
- registrarli in `NOMI_GRAFICI` (editor-analisi.tsx:81) e nello switch di
  `grafico-da-risultato.tsx`.
- `graficiPossibili(risultato)` deve offrirli SOLO quando la forma del dato li
  regge, secondo la colonna "forma del dato richiesta" qui sopra. Un grafico
  offerto su dati che non lo reggono e' peggio che non averlo: l'utente lo
  sceglie e vede una figura senza senso.
- `scegliGrafico` (la proposta automatica) puo' proporre `matrice` al posto di
  `heatmap` quando le due dimensioni hanno poche categorie (<= 12 x 12), e
  `pendenza` quando ci sono esattamente 2 periodi. Gli altri quattro restano
  scelte manuali: non proporli d'ufficio.
- le regole dure esistenti restano: mai un grafico di composizione su una serie
  temporale, mai su percentuali, mai su valori negativi.
- ogni grafico deve gestire il caso "dati insufficienti" mostrando un messaggio
  che dice cosa manca, non una figura vuota.

## Test obbligatori (vitest, in `prototipo-bi/`)

1. `graficiPossibili` non offre `pendenza` con 3 periodi, la offre con 2.
2. `graficiPossibili` non offre `matrice` con un solo raggruppamento.
3. `graficiPossibili` non offre `posizioni` con meno di 3 periodi.
4. `scegliGrafico` non propone mai `distribuzione`, `flusso`, `istogramma`.
5. `scegliGrafico` propone `matrice` con 2 dimensioni piccole e resta su
   `heatmap` quando sono grandi.
6. un colore non valido viene rifiutato dal validatore delle serie.
7. render test (@testing-library/react) di ognuno dei sei grafici con dati
   validi: non lancia, e produce un `<svg>` o una `<table>`.

## Vincoli non negoziabili

- **NON leggere, aprire, elencare o cercare dentro `prototipo-bi/dati/`.**
  Contiene uno snapshot da 35 MB che ha gia' ucciso un job. Nessun `cat`,
  `Get-Content`, `grep`, `find` che ci entri dentro.
- Nessun `any`: il progetto lo vieta.
- Nomi di variabili, funzioni e commenti in italiano, come il resto del BI.
- Toccare SOLO: `src/lib/prototipo-bi/**`, `src/components/prototipo-bi/**`,
  `src/app/api/bi/**`, `prototipo-bi/*.test.ts`. Nient'altro nel repo.
- **Non fare commit.** Lascia le modifiche nel working tree.
- Alla fine devono passare: `npx tsc --noEmit` e `npx vitest run prototipo-bi/`.
  Riporta l'esito reale di entrambi, non "dovrebbe passare".
