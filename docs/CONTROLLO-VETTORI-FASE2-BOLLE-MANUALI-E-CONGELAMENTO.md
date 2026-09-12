# Fase 2 — Bolle inseribili a mano, campi forzabili, congelamento alla fattura

Data: 12 settembre 2026. Decisioni prese con Sebastiano; implementazione da fare.

## Le tre regole

1. **Arrivi sparisce.** Tutto passa da Bolle. La pagina `/vettori/arrivi` era sospesa dal 9
   settembre e le sue tabelle sono vuote: non si perde niente.
2. **Una bolla si può creare interamente a mano**, compilando numero, data, controparte,
   vettore, colli, peso e dimensioni. Serve a chi ha la merce davanti e nel sistema non ha
   ancora nessun documento.
3. **Quando il gestionale porta la stessa bolla, i suoi dati sostituiscono quelli inseriti a
   mano — tranne le dimensioni.** Le dimensioni nel gestionale non esistono e non esisteranno
   mai: sovrascriverle con un vuoto sarebbe distruggere l'unico dato che abbiamo.
4. **I campi che arrivano dal gestionale si possono forzare a mano.** Un dato sbagliato
   all'origine deve poter essere corretto da chi vede la merce.
5. **Dal momento in cui la bolla viene agganciata a una riga di fattura, si congela tutto.**
   Misure comprese.

## Il modello esiste gia': non serve una tabella nuova

L'istinto sarebbe creare `vettori.bolle`. Sarebbe un errore: duplicherebbe
`vettori.spedizioni`, che e' gia' esattamente questo — la spedizione logica, con
`numero_riferimento`, controparte, colli, peso, `origine` (`gestionale` | `manuale` |
`excel_storico`) e `stato`.

Il disegno diventa allora:

| Cosa | Dove |
|---|---|
| La bolla, comunque sia nata | `vettori.spedizioni` |
| Il legame con i documenti del gestionale | `vettori.spedizioni_documenti` (esiste gia') |
| Le dimensioni dei colli | `vettori.bolla_misure` |
| Il grezzo del gestionale, sola lettura | `bi.trasporti_documenti` |
| L'aggancio alla fattura, che fa scattare il congelamento | `vettori.controlli.spedizione_id` |

### Una correzione necessaria alla 096

`vettori.bolla_misure.id_documento` punta oggi a `bi.trasporti_documenti(id_documento)`.
Con le bolle manuali quel vincolo non regge: una bolla inserita a mano **non ha** un
documento nel gestionale, e non potrebbe avere misure.

La chiave esterna va spostata su `vettori.spedizioni(id)`. Le misure appartengono alla
spedizione, non al documento: e' la spedizione l'unita' che il vettore fattura, ed e' quella
che sopravvive sia all'inserimento manuale sia all'arrivo successivo del documento.

Entrambe le tabelle sono **vuote su sviluppo e produzione** (verificato il 12 settembre), quindi
la modifica e' pulita e non richiede migrazione di dati.

## Il ciclo di vita di una bolla

```
   inserita a mano                     arrivata dal gestionale
   origine = 'manuale'                 origine = 'gestionale'
          │                                      │
          └──────────────┬───────────────────────┘
                         │
                    APERTA — tutto modificabile
                         │
         il gestionale porta un documento che combacia
                         │
                    FUSIONE
       i campi del gestionale sostituiscono quelli a mano
       ECCETTO le dimensioni e i campi esplicitamente forzati
                         │
                    APERTA — ancora modificabile, con traccia
                         │
              nasce un vettori.controlli per questa spedizione
                         │
                    CONGELATA — niente e' piu' modificabile
```

### Cosa significa "combacia"

Il match usa la stessa chiave dell'unicita' gia' presente su `vettori.spedizioni`:
direzione + riferimento normalizzato + data documento. La normalizzazione e' quella di
`normalizzaRiferimento` in `src/lib/portali/vettori/fatture/testo.ts` e **non va
reimplementata**: due normalizzazioni scritte in due posti divergono, e quando divergono
l'aggancio smette di funzionare senza che niente lo dica.

### I campi forzati

Serve ricordare **quali** campi una persona ha corretto a mano, altrimenti il primo refresh
dal gestionale li riporta al valore sbagliato e l'operatore rifa' il lavoro ogni giorno.

Un `campi_forzati jsonb` su `vettori.spedizioni`, con nome del campo, valore precedente, chi
e quando. La fusione salta i campi elencati li' dentro.

> [!warning] Il valore precedente serve
> Senza, non si puo' piu' rispondere alla domanda «il gestionale cosa diceva?», che e'
> esattamente la domanda che si fa quando il conto non torna.

## I casi limite, e come si risolvono

**La fattura arriva prima del documento dal gestionale.** Succede, e va bene: il controllo
aggancia la spedizione manuale e la congela. Il documento che arrivera' dopo si limitera' a
collegarsi, senza sovrascrivere niente.

**Il gestionale porta una bolla che combacia con una spedizione gia' congelata.** Non si
sovrascrive nulla e non si fallisce in silenzio: si registra uno scostamento visibile, perche'
significa che il documento e la fattura raccontano cose diverse ed e' proprio il genere di
caso che questo portale esiste per intercettare.

**Scongelare.** Deve essere possibile, altrimenti un errore di battitura diventa definitivo.
Solo il ruolo `amministrazione`, con traccia di chi e quando. Non e' un'operazione da
nascondere, e' un'operazione da registrare.

**Una bolla manuale che nessun documento raggiunge mai.** Resta li', valida. Non e' un errore:
e' il caso di chi misura merce che nel gestionale non entrera'.

## Cosa cambia nell'interfaccia

- Un pulsante per creare una bolla da zero, con tutti i campi.
- Su ogni campo che viene dal gestionale, la possibilita' di forzarlo, e un segno visibile
  quando e' stato forzato — con il valore originale a portata di sguardo.
- Uno stato **congelata** evidente, che spiega *perche'* e' congelata (aggancio a quale
  fattura) invece di limitarsi a disabilitare i controlli.
- L'origine visibile: `gestionale`, `manuale`, `excel_storico`.

## Cosa NON cambia

`bi.trasporti_documenti` resta di sola lettura per l'applicazione. Un campo forzato **non**
torna indietro nel grezzo: si sovrascrive la lettura, non la fonte. Il giorno che si vuole
sapere cosa diceva davvero il gestionale, quel dato e' ancora li' intatto.

Collegato a: [[Controllo Vettori - Bolle e Misure]] · [[Controllo Vettori - Schema DB]] · [[intranet-sics]].
