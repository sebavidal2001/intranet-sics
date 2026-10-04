// Elenca (senza cancellare nulla) branch e worktree già dentro origin/main.
// Uso: npm run pulizia-branch
import { execSync } from "node:child_process";

const git = (c) => execSync(`git ${c}`, { encoding: "utf8" }).trim();
git("fetch --prune origin");

const worktree = new Map(); // branch -> percorso
let corrente = "";
for (const riga of git("worktree list --porcelain").split("\n")) {
  if (riga.startsWith("worktree ")) corrente = riga.slice(9);
  if (riga.startsWith("branch ")) worktree.set(riga.slice(18), corrente);
}

const unici = (rif) =>
  git(`cherry origin/main ${rif}`).split("\n").filter((r) => r.startsWith("+")).length;

console.log("Branch locali già in origin/main (cancellabili):");
for (const b of git("for-each-ref refs/heads --format=%(refname:short)").split("\n")) {
  if (b === "main") continue;
  const n = unici(b);
  const wt = worktree.get(b);
  const vuoto = n === 0 && git(`rev-parse ${b}`) === git("rev-parse origin/main");
  console.log(`  ${vuoto ? "[nuovo]" : n === 0 ? "[ok]   " : "[tieni]"} ${b}${n ? ` (${n} commit non in main)` : ""}${wt ? `  <- worktree: ${wt}` : ""}`);
}
console.log("\nBranch remoti già in origin/main:");
for (const b of git("for-each-ref refs/remotes/origin --format=%(refname:short)").split("\n")) {
  if (!b.startsWith("origin/") || b === "origin/main" || b === "origin/HEAD") continue;
  if (unici(b) === 0) console.log(`  [ok]    ${b}`);
}
console.log("\nCancella a mano: git worktree remove <percorso>; git branch -D <branch>; git push origin --delete <branch>");
