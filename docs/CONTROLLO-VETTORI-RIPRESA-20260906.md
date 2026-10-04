# Ripresa del controllo vettori — 6 settembre 2026

Conversazione recuperata: **Carrier invoice control intranet system**, sessione Claude `a9f33887-622a-4e2c-9a75-87d1c742189c`. Si era interrotta dopo la costruzione delle pagine operative.

## Modifiche operative

- In `/vettori/listini`, **Modifica tariffe** permette di cambiare soglie, importi fissi/al quintale, scatti e valori dei supplementi. **Salva nuova versione** richiede nome e decorrenza successiva alla versione precedente. La RPC `vettori.versiona_listino` chiude la precedente il giorno prima e copia le condizioni nella nuova versione in una transazione; i controlli acquisiti restano invariati. Non cambia anagrafica o copertura delle zone.
- Il fuel usa l'ultima comunicazione con anno/mese non successivo alla spedizione. Luglio rimane valido in agosto, settembre e oltre, fino alla nuova comunicazione; zero è un valore valido. Non si applica una comunicazione futura a una spedizione passata. Trading Post, in assenza di fuel esplicito, usa zero perché l'addizionale è nei supplementi.
- Trading Post ricava la provincia anche dalla fattura, senza dipendere dalla bolla. FO nelle fatture di Forlì/Bertinoro viene risolta come FC del listino.
- Il calcolo utilizza il peso volumetrico riportato in fattura quando manca il volume. GLS ripartisce ISTAT e carburante del piede sulle righe in proporzione al nolo, conservando i centesimi dichiarati e rendendo omogenei fatturato e atteso.
- Gli errori nelle query dei listini non vengono più trasformati in elenchi vuoti. Le righe non valutabili sono visibili, con il motivo, e il riepilogo dichiara il confronto incompleto. Nessuna fascia applicabile non equivale all'ultima fascia disponibile.
- La cache dei calcoli distingue il giorno, così una variazione a metà mese non si estende erroneamente all'intero mese. Il controllo conserva anche l'ID del listino applicato.

## Database e verifiche

Migration `093_vettori_listini_configurabili.sql` applicata al **database Supabase di sviluppo** configurato in `.env.local`. Prima dell'applicazione: transazione annullata con prova di nuova versione, conservazione delle tariffe storiche, copia dei supplementi, rollback dopo zona invalida, rifiuto di scrittura concorrente e assenza di permesso diretto per `authenticated`.

177 test del modulo verdi; TypeScript ed ESLint superati. Ulteriore collaudo in sola lettura delle anteprime con testo estratto dalle fatture GLS/TNT/Trading Post di luglio e agosto. Nessuna fattura di prova acquisita.

Esempio GLS luglio: fatturato completo **1.238,46 €**, atteso **1.104,53 €**, differenza **133,93 €**, con 37 scostamenti oltre soglia. Sono controlli tariffari con zona predefinita dove manca la provincia, non contestazioni già validate.

Comandi:

```powershell
npx vitest run src/tests/vettori-interfaccia.test.tsx src/tests/vettori-configurazione.test.ts src/tests/vettori-calcolo.test.ts src/tests/vettori-fatture.test.ts src/tests/vettori-listini-db.test.ts src/tests/vettori-abbinamento.test.ts src/tests/vettori-comunicazioni.test.ts
npm run type-check
npx vitest run --config scripts/vettori/vitest.config.ts
node scripts/vettori/migrazione-config.mjs --collauda
```

L'ultimo comando esegue il collaudo SQL con rollback; `--applica` applica la migration. Gli script leggono le credenziali dall'ambiente e non le stampano.

## Dati ancora necessari

- Nel database di sviluppo `bi.trasporti_documenti` è vuota: le fatture producono controlli tariffari ma nessun abbinamento alle bolle. La pipeline sulla VM è un'attività separata, già descritta in `docs/bi/PROMPT-CODEX-pipeline-bolle-produzione.md`.
- TNT luglio comprende due spedizioni di giugno: manca il fuel di giugno o di un mese precedente, quindi restano non valutabili.
- Trading Post luglio comprende una spedizione a **Rovigo (RO)**, fuori dalla copertura configurata. Serve la tariffa concordata per quella tratta; non è stata inventata una tariffa di ripiego.
- La verifica del browser ha raggiunto la pagina di login: nessuna sessione autenticata disponibile nel browser Codex. Editor e persistenza dell'input su errore verificati con test dei componenti; non verificato un upload PDF dal browser autenticato.
- Nessun deploy sulla VM di produzione. Ricaricare una fattura in anteprima usa il codice aggiornato; le fatture già acquisite mantengono i controlli salvati.

Collegato a: [[Controllo Vettori - Listini e Motore di Calcolo]] · [[Controllo Vettori - Schema DB]] · [[intranet-sics]].
