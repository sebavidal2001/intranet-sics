import { permanentRedirect } from "next/navigation";

/**
 * La pagina si chiamava «Cruscotto» ed è diventata «Analisi».
 *
 * Il vecchio indirizzo resta e reindirizza: chi l'ha messo fra i preferiti o
 * l'ha incollato in un'email non deve trovare un 404 per un cambio di nome.
 */
export default function CruscottoPage() {
  permanentRedirect("/vettori/analisi");
}
