"use client";

/**
 * Mappa dei risultati diviso per CAP o provincia.
 *
 * Due letture della stessa carta, scelte dalla forma del dato:
 *   · PER LUOGO — un cerchio per CAP (o provincia), grande in proporzione al
 *     valore: dove si concentrano le visite.
 *   · PER GIORNATA — se il risultato ha anche il giorno e l'id della visita
 *     (granularità «giorno» con suddivisione «CAP» e «Documento»), le tappe di
 *     un giorno sono unite da una linea numerata, con un selettore del giorno.
 *
 * Cosa la mappa NON sa, e lo dice: il gestionale non registra l'ora delle
 * visite, quindi l'ordine delle tappe è quello di registrazione; e non ha le
 * coordinate dei clienti, quindi il punto è il centro del CAP (o il
 * capoluogo di provincia, quando il CAP non è noto), non l'indirizzo.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { RisultatoQuery } from "@/lib/prototipo-bi/tipi";
import { formattaValore } from "@/lib/prototipo-bi/semantico";

interface PuntoCap {
  cap: string;
  lat: number;
  lon: number;
  precisione: "cap" | "provincia";
  comune: string | null;
  provincia: string | null;
}
interface PuntoProvincia {
  provincia: string;
  nome: string;
  lat: number;
  lon: number;
}
interface Geografia {
  cap: Map<string, PuntoCap>;
  province: Map<string, PuntoProvincia>;
}

// Una sola richiesta per pagina: più riquadri mappa condividono le coordinate.
let geografiaInCorso: Promise<Geografia> | null = null;

function caricaGeografia(): Promise<Geografia> {
  if (!geografiaInCorso) {
    geografiaInCorso = fetch("/api/bi/geo")
      .then(async (r) => {
        if (!r.ok) throw new Error("Coordinate non disponibili.");
        const corpo = (await r.json()) as { cap: PuntoCap[]; province: PuntoProvincia[] };
        return {
          cap: new Map(corpo.cap.map((p) => [p.cap, p])),
          province: new Map(corpo.province.map((p) => [p.provincia, p])),
        };
      })
      .catch((e: unknown) => {
        geografiaInCorso = null; // riprova alla prossima apertura
        throw e;
      });
  }
  return geografiaInCorso;
}

interface Tappa {
  ordine: number;
  documento: string;
  luogo: string;
  lat: number;
  lon: number;
  precisione: "cap" | "provincia";
}

const CENTRO_ITALIA: [number, number] = [42.5, 12.5];

export function MappaVisite({
  risultato,
  altezza = 360,
}: {
  risultato: RisultatoQuery;
  altezza?: number;
}) {
  const contenitore = useRef<HTMLDivElement | null>(null);
  const [geo, setGeo] = useState<Geografia | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [giorno, setGiorno] = useState<string | null>(null);

  useEffect(() => {
    let attivo = true;
    caricaGeografia()
      .then((g) => attivo && setGeo(g))
      .catch((e: unknown) => attivo && setErrore(e instanceof Error ? e.message : "Coordinate non disponibili."));
    return () => {
      attivo = false;
    };
  }, []);

  const dimensione = (risultato.spec.raggruppa ?? []).includes("cap") ? "cap" : "provincia";
  const perGiornata =
    dimensione === "cap" &&
    risultato.spec.granularita === "giorno" &&
    (risultato.spec.raggruppa ?? []).includes("documento");

  // ── Lettura per luogo ─────────────────────────────────────────────────────
  const luoghi = useMemo(() => {
    if (!geo || perGiornata) return null;
    const perLuogo = new Map<string, { valore: number; lat: number; lon: number; etichetta: string; precisione: "cap" | "provincia" }>();
    let senzaPosizione = 0;
    for (const riga of risultato.righe) {
      const chiave = riga.chiavi[dimensione] ?? "";
      const p = dimensione === "cap" ? geo.cap.get(chiave) : geo.province.get(chiave);
      if (!p) {
        senzaPosizione += riga.valore;
        continue;
      }
      const esistente = perLuogo.get(chiave);
      const etichetta =
        dimensione === "cap"
          ? `${chiave}${(p as PuntoCap).comune ? ` · ${(p as PuntoCap).comune}` : ""}`
          : `${(p as PuntoProvincia).nome} (${chiave})`;
      perLuogo.set(chiave, {
        valore: (esistente?.valore ?? 0) + riga.valore,
        lat: p.lat,
        lon: p.lon,
        etichetta,
        precisione: dimensione === "cap" ? (p as PuntoCap).precisione : "cap",
      });
    }
    return { luoghi: [...perLuogo.values()], senzaPosizione };
  }, [geo, risultato, dimensione, perGiornata]);

  // ── Lettura per giornata ──────────────────────────────────────────────────
  const giornate = useMemo(() => {
    if (!geo || !perGiornata) return null;
    const perGiorno = new Map<string, Tappa[]>();
    let senzaPosizione = 0;
    for (const riga of risultato.righe) {
      const p = geo.cap.get(riga.chiavi.cap ?? "");
      if (!p) {
        senzaPosizione += 1;
        continue;
      }
      const g = riga.chiavi.periodo ?? "";
      const elenco = perGiorno.get(g) ?? [];
      elenco.push({
        ordine: 0,
        documento: riga.chiavi.documento ?? "",
        luogo: `${p.cap}${p.comune ? ` · ${p.comune}` : ""}`,
        lat: p.lat,
        lon: p.lon,
        precisione: p.precisione,
      });
      perGiorno.set(g, elenco);
    }
    for (const elenco of perGiorno.values()) {
      // L'id della visita è zero-padded: l'ordine come testo è l'ordine numerico.
      elenco.sort((a, b) => a.documento.localeCompare(b.documento));
      elenco.forEach((t, i) => (t.ordine = i + 1));
    }
    return { perGiorno, giorni: [...perGiorno.keys()].sort(), senzaPosizione };
  }, [geo, risultato, perGiornata]);

  const giornoAttivo = giornate ? (giorno && giornate.perGiorno.has(giorno) ? giorno : giornate.giorni[giornate.giorni.length - 1] ?? null) : null;

  // ── Disegno ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const nodo = contenitore.current;
    if (!nodo || (!luoghi && !giornate)) return;
    let mappa: import("leaflet").Map | null = null;
    let annullato = false;

    void import("leaflet").then((modulo) => {
      if (annullato || !contenitore.current) return;
      const L = modulo.default ?? modulo;
      mappa = L.map(nodo, { scrollWheelZoom: false, attributionControl: true }).setView(CENTRO_ITALIA, 5);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: "© OpenStreetMap",
      }).addTo(mappa);

      const punti: [number, number][] = [];

      if (luoghi) {
        const massimo = Math.max(1, ...luoghi.luoghi.map((l) => l.valore));
        for (const l of luoghi.luoghi) {
          // L'area, non il raggio, è proporzionale al valore.
          const raggio = 6 + 22 * Math.sqrt(Math.max(0, l.valore) / massimo);
          L.circleMarker([l.lat, l.lon], {
            radius: raggio,
            color: "#007a91",
            weight: 1,
            fillColor: "#00a1be",
            fillOpacity: l.precisione === "provincia" ? 0.25 : 0.55,
            dashArray: l.precisione === "provincia" ? "3 3" : undefined,
          })
            .bindTooltip(`${l.etichetta}: ${formattaValore(l.valore, risultato.unita === "euro" ? "euro" : "numero")}`)
            .addTo(mappa);
          punti.push([l.lat, l.lon]);
        }
      }

      if (giornate && giornoAttivo) {
        const tappe = giornate.perGiorno.get(giornoAttivo) ?? [];
        const linea = tappe.map((t) => [t.lat, t.lon] as [number, number]);
        if (linea.length > 1) L.polyline(linea, { color: "#007a91", weight: 3, opacity: 0.7 }).addTo(mappa);
        for (const t of tappe) {
          L.marker([t.lat, t.lon], {
            icon: L.divIcon({
              className: "",
              iconSize: [26, 26],
              html: `<div style="width:26px;height:26px;border-radius:50%;background:#00a1be;color:#fff;font:600 12px system-ui;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${t.ordine}</div>`,
            }),
          })
            .bindTooltip(`${t.ordine}ª tappa · ${t.luogo}`)
            .addTo(mappa);
          punti.push([t.lat, t.lon]);
        }
      }

      if (punti.length > 0) mappa.fitBounds(punti, { padding: [30, 30], maxZoom: 11 });
    });

    return () => {
      annullato = true;
      mappa?.remove();
    };
  }, [luoghi, giornate, giornoAttivo, risultato.unita]);

  if (errore) return <div role="alert" className="p-4 text-sm text-danger">{errore}</div>;

  const senzaPosizione = luoghi?.senzaPosizione ?? giornate?.senzaPosizione ?? 0;
  const approssimati = luoghi?.luoghi.some((l) => l.precisione === "provincia") ?? false;

  return (
    <div className="flex flex-col gap-2">
      {giornate && (
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Giornata
          <select
            value={giornoAttivo ?? ""}
            onChange={(e) => setGiorno(e.target.value)}
            className="h-8 rounded-lg border border-border bg-bg-page px-2 text-sm text-text"
          >
            {giornate.giorni.map((g) => (
              <option key={g} value={g}>
                {new Date(`${g}T00:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                {" · "}
                {giornate.perGiorno.get(g)?.length ?? 0} tappe
              </option>
            ))}
          </select>
        </label>
      )}
      <div ref={contenitore} style={{ height: altezza }} className="w-full overflow-hidden rounded-lg border border-border" role="img" aria-label="Mappa" />
      <p className="text-[11px] leading-snug text-text-muted">
        Il punto è il centro del CAP{approssimati ? " (tratteggiato: solo il capoluogo di provincia, il CAP non è nell'elenco)" : ""}, non l&apos;indirizzo.
        {giornate ? " Il gestionale non registra l'ora: le tappe seguono l'ordine di registrazione, che può non essere quello del giro." : ""}
        {senzaPosizione > 0 ? ` ${senzaPosizione} ${giornate ? "visite" : "unità"} non hanno una posizione e non compaiono.` : ""}
      </p>
    </div>
  );
}
