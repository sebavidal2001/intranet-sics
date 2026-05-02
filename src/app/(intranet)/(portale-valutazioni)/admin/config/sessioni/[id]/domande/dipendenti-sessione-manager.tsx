"use client";

import { DipendentRow } from "./dipendent-row";
import type {
  Utente,
  Scala,
  AllSkill,
  SessioneUtente,
  UtenteMansione,
  RuoloProfessionale,
  SessioneSkill,
} from "./dipendent-row";

interface Props {
  sessioneId: string;
  sessioneAnno: number;
  utenti: Utente[];
  scale: Scala[];
  sessioniUtente: SessioneUtente[];
  utenteMansioni: UtenteMansione[];
  ruoliProfessionali: RuoloProfessionale[];
  allSkills: AllSkill[];
  sessioneSkills: SessioneSkill[];
}

export default function DipendentiSessioneManager({
  sessioneId,
  sessioneAnno,
  utenti,
  scale,
  sessioniUtente,
  utenteMansioni,
  ruoliProfessionali,
  allSkills,
  sessioneSkills,
}: Props) {
  const sessionePerUtente = new Map<string, SessioneUtente>();
  for (const s of sessioniUtente) {
    sessionePerUtente.set(s.utente_id, s);
  }

  // Build skill ids per sessione_utente
  const skillsPerSessione = new Map<string, string[]>();
  for (const ss of sessioneSkills) {
    const existing = skillsPerSessione.get(ss.sessione_id) ?? [];
    existing.push(ss.skill_id);
    skillsPerSessione.set(ss.sessione_id, existing);
  }

  const conSessione = utenti.filter((u) => sessionePerUtente.has(u.id));
  const senzaSessione = utenti.filter((u) => !sessionePerUtente.has(u.id));
  const sortedUtenti = [...conSessione, ...senzaSessione];

  return (
    <div className="bg-bg rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-bg-page flex items-center justify-between">
        <h3 className="font-tenorite text-sm text-text">
          Dipendenti ({utenti.length})
        </h3>
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>{conSessione.length} programmati</span>
          <span>{senzaSessione.length} da programmare</span>
        </div>
      </div>

      <div className="divide-y divide-border">
        {sortedUtenti.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">
            Nessun dipendente attivo trovato.
          </div>
        ) : (
          sortedUtenti.map((u) => {
            const sess = sessionePerUtente.get(u.id);
            const skillIds = sess ? (skillsPerSessione.get(sess.id) ?? []) : [];
            return (
              <DipendentRow
                key={u.id}
                utente={u}
                sessione={sess}
                scale={scale}
                mansioni={utenteMansioni}
                ruoliProfessionali={ruoliProfessionali}
                allSkills={allSkills}
                initialSkillIds={skillIds}
                anno={sessioneAnno}
                sessioneId={sessioneId}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
