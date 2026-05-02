# Formato import valutazioni storiche

## File CSV accettato
anno,utente_email,parametro,punteggio,tipo
2023,mario.rossi@sics.it,Comunicazione,4,auto
2023,mario.rossi@sics.it,Comunicazione,3,responsabile

## Colonne obbligatorie
- anno: integer (es. 2023)
- utente_email: deve corrispondere a un utente esistente
- parametro: nome del parametro radar (case-insensitive)
- punteggio: valore numerico nella scala usata quell'anno
- tipo: auto oppure responsabile

## Parametri non piu esistenti
Vengono importati con is_storico = true.
Nei grafici appaiono in grigio tratteggiato con badge [storico].
Non bloccano l'import - vengono segnalati come warning.