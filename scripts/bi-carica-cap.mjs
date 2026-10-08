/**
 * bi-carica-cap.mjs — Genera lo SQL che carica bi.cap_coordinate dall'elenco
 * dei CAP italiani di GeoNames (IT.txt, licenza CC-BY 4.0, https://www.geonames.org).
 *
 * Non si collega a nessun database: scrive un file .sql da applicare con psql,
 * così il caricamento si guarda prima di farlo (e si rifà identico).
 *
 * Uso:
 *   node scripts/bi-carica-cap.mjs --file=IT.txt --out=cap.sql
 *   sudo -u postgres psql -d intranet -v ON_ERROR_STOP=1 -f cap.sql
 *
 * Tracciato di IT.txt (tab): paese, CAP, località, regione, cod. regione,
 * provincia, SIGLA PROVINCIA, comune, cod. comune, LAT, LON, precisione.
 *
 * Un CAP può coprire più località (e una città ha più CAP con la stessa
 * località): per ogni CAP si fa la MEDIA delle coordinate, e come comune si
 * prende la località più frequente. È il centro del CAP, non un indirizzo.
 */

import fs from "fs";

const arg = (n) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split("=").slice(1).join("=") : null;
};
const FILE = arg("file");
const OUT = arg("out");
if (!FILE || !OUT) {
  console.error("Uso: node scripts/bi-carica-cap.mjs --file=IT.txt --out=cap.sql");
  process.exit(1);
}

const sql = (t) => `'${String(t).replace(/'/g, "''")}'`;

const perCap = new Map();
for (const riga of fs.readFileSync(FILE, "utf8").split(/\r?\n/)) {
  if (!riga.trim()) continue;
  const c = riga.split("\t");
  if (c.length < 11) continue;
  const cap = c[1].trim();
  const lat = Number(c[9]);
  const lon = Number(c[10]);
  if (!/^\d{5}$/.test(cap) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const voce = perCap.get(cap) ?? { lat: 0, lon: 0, n: 0, localita: new Map(), province: new Map() };
  voce.lat += lat;
  voce.lon += lon;
  voce.n += 1;
  voce.localita.set(c[2], (voce.localita.get(c[2]) ?? 0) + 1);
  voce.province.set(c[6], (voce.province.get(c[6]) ?? 0) + 1);
  perCap.set(cap, voce);
}

const piuFrequente = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

const valori = [...perCap.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([cap, v]) => {
    const lat = (v.lat / v.n).toFixed(5);
    const lon = (v.lon / v.n).toFixed(5);
    const prov = piuFrequente(v.province);
    return `(${sql(cap)},${lat},${lon},${sql(piuFrequente(v.localita))},${prov ? sql(prov) : "null"},'geonames')`;
  });

const righe = [
  "-- Generato da scripts/bi-carica-cap.mjs da GeoNames IT.txt (CC-BY 4.0).",
  "begin;",
  "delete from bi.cap_coordinate where origine = 'geonames';",
  "insert into bi.cap_coordinate (cap, lat, lon, comune, provincia, origine) values",
  valori.join(",\n"),
  "on conflict (cap) do update set lat = excluded.lat, lon = excluded.lon,",
  "  comune = excluded.comune, provincia = excluded.provincia, origine = excluded.origine;",
  "commit;",
  "",
];
fs.writeFileSync(OUT, righe.join("\n"));
console.log(`CAP: ${perCap.size} -> ${OUT}`);
