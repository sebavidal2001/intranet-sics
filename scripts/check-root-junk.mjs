// Guardia anti-spazzatura: fallisce se nella root del repo compaiono file non
// previsti (tipicamente generati per errore da comandi/heredoc finiti male,
// es. file con nomi "," "-" "void," "`###" ...). Usata in CI e via `npm run check:root`.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// File di root ammessi (tracciati). Le dotfile note + i config di progetto.
const ALLOW = new Set([
  ".env.example", ".env.local.example", ".eslintrc.json", ".gitignore", ".mcp.json",
  "CLAUDE.md", "DEPLOYMENT.md", "README.md", "deploy.sh",
  "next.config.mjs", "package.json", "package-lock.json",
  "postcss.config.mjs", "tailwind.config.mjs", "tsconfig.json", "vitest.config.ts",
  // ambiente/locali ignorati da git ma legittimi
  ".env", ".env.local", "tsconfig.tsbuildinfo", "next-env.d.ts",
]);

// Cartelle ignorate
const SKIP_DIR = new Set([".git", ".next", "node_modules", ".swarm", ".claude", ".claude-flow"]);

const sospetti = [];
for (const name of readdirSync(ROOT)) {
  if (ALLOW.has(name)) continue;
  let st;
  try { st = statSync(join(ROOT, name)); } catch { continue; }
  if (st.isDirectory()) continue;            // le cartelle non sono "junk di root"
  if (name.startsWith(".env")) continue;     // varianti env locali
  if (name.endsWith(".log")) continue;       // log dev locali (gitignored)
  sospetti.push(name);
}

if (sospetti.length > 0) {
  console.error("❌ File sospetti nella root del repository (rimuovili o aggiungili all'allowlist):");
  for (const s of sospetti) console.error("   - " + JSON.stringify(s));
  process.exit(1);
}
console.log("✓ Root pulita: nessun file sospetto.");
