export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      certificato_config: {
        Row: {
          codice_documento: string
          colore_primario: string
          colore_testo: string
          data_aggiornamento: string
          data_edizione: string
          etichetta_anzianita: string
          etichetta_area: string
          etichetta_data_assunzione: string
          etichetta_data_valutazione: string
          etichetta_responsabile: string
          etichetta_valutatore: string
          font_corpo: string
          id: string
          logo_url: string | null
          mostra_radar: boolean
          orientamento: string
          titolo_coordinatori: string
          titolo_personale: string
          titolo_responsabili: string
          updated_at: string | null
        }
        Insert: {
          codice_documento?: string
          colore_primario?: string
          colore_testo?: string
          data_aggiornamento?: string
          data_edizione?: string
          etichetta_anzianita?: string
          etichetta_area?: string
          etichetta_data_assunzione?: string
          etichetta_data_valutazione?: string
          etichetta_responsabile?: string
          etichetta_valutatore?: string
          font_corpo?: string
          id?: string
          logo_url?: string | null
          mostra_radar?: boolean
          orientamento?: string
          titolo_coordinatori?: string
          titolo_personale?: string
          titolo_responsabili?: string
          updated_at?: string | null
        }
        Update: {
          codice_documento?: string
          colore_primario?: string
          colore_testo?: string
          data_aggiornamento?: string
          data_edizione?: string
          etichetta_anzianita?: string
          etichetta_area?: string
          etichetta_data_assunzione?: string
          etichetta_data_valutazione?: string
          etichetta_responsabile?: string
          etichetta_valutatore?: string
          font_corpo?: string
          id?: string
          logo_url?: string | null
          mostra_radar?: boolean
          orientamento?: string
          titolo_coordinatori?: string
          titolo_personale?: string
          titolo_responsabili?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      domande: {
        Row: {
          created_at: string | null
          id: string
          ordine: number
          parametro_id: string | null
          sessione_id: string | null
          testo: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          ordine: number
          parametro_id?: string | null
          sessione_id?: string | null
          testo: string
        }
        Update: {
          created_at?: string | null
          id?: string
          ordine?: number
          parametro_id?: string | null
          sessione_id?: string | null
          testo?: string
        }
        Relationships: [
          {
            foreignKeyName: "domande_parametro_id_fkey"
            columns: ["parametro_id"]
            isOneToOne: false
            referencedRelation: "parametri_radar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domande_sessione_id_fkey"
            columns: ["sessione_id"]
            isOneToOne: false
            referencedRelation: "sessioni_valutazione"
            referencedColumns: ["id"]
          },
        ]
      }
      homepage_blocks: {
        Row: {
          created_at: string
          icona: string | null
          id: string
          is_attivo: boolean
          ordine: number
          testo: string | null
          tipo: string
          titolo: string
          url: string | null
        }
        Insert: {
          created_at?: string
          icona?: string | null
          id?: string
          is_attivo?: boolean
          ordine?: number
          testo?: string | null
          tipo: string
          titolo: string
          url?: string | null
        }
        Update: {
          created_at?: string
          icona?: string | null
          id?: string
          is_attivo?: boolean
          ordine?: number
          testo?: string | null
          tipo?: string
          titolo?: string
          url?: string | null
        }
        Relationships: []
      }
      kpi_config: {
        Row: {
          anno: number | null
          created_at: string | null
          id: string
          nome: string
          operatore: string
          parametro_id: string | null
          soglia: number
          updated_at: string | null
        }
        Insert: {
          anno?: number | null
          created_at?: string | null
          id?: string
          nome: string
          operatore: string
          parametro_id?: string | null
          soglia: number
          updated_at?: string | null
        }
        Update: {
          anno?: number | null
          created_at?: string | null
          id?: string
          nome?: string
          operatore?: string
          parametro_id?: string | null
          soglia?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_config_parametro_id_fkey"
            columns: ["parametro_id"]
            isOneToOne: false
            referencedRelation: "parametri_radar"
            referencedColumns: ["id"]
          },
        ]
      }
      mansionari: {
        Row: {
          anno: number
          competenze: Json
          created_at: string | null
          id: string
          mansione: string
          updated_at: string | null
          utente_id: string | null
        }
        Insert: {
          anno: number
          competenze: Json
          created_at?: string | null
          id?: string
          mansione: string
          updated_at?: string | null
          utente_id?: string | null
        }
        Update: {
          anno?: number
          competenze?: Json
          created_at?: string | null
          id?: string
          mansione?: string
          updated_at?: string | null
          utente_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mansionari_utente_id_fkey"
            columns: ["utente_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      mansioni: {
        Row: {
          created_at: string
          id: string
          ordine: number
          parametro_radar_id: string | null
          ruolo_professionale_id: string
          testo: string
        }
        Insert: {
          created_at?: string
          id?: string
          ordine?: number
          parametro_radar_id?: string | null
          ruolo_professionale_id: string
          testo: string
        }
        Update: {
          created_at?: string
          id?: string
          ordine?: number
          parametro_radar_id?: string | null
          ruolo_professionale_id?: string
          testo?: string
        }
        Relationships: [
          {
            foreignKeyName: "mansioni_parametro_radar_id_fkey"
            columns: ["parametro_radar_id"]
            isOneToOne: false
            referencedRelation: "parametri_radar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mansioni_ruolo_professionale_id_fkey"
            columns: ["ruolo_professionale_id"]
            isOneToOne: false
            referencedRelation: "ruoli_professionali"
            referencedColumns: ["id"]
          },
        ]
      }
      parametri_radar: {
        Row: {
          colore: string
          created_at: string | null
          descrizione: string | null
          id: string
          is_storico: boolean | null
          nome: string
          ordine: number
          updated_at: string | null
        }
        Insert: {
          colore: string
          created_at?: string | null
          descrizione?: string | null
          id?: string
          is_storico?: boolean | null
          nome: string
          ordine: number
          updated_at?: string | null
        }
        Update: {
          colore?: string
          created_at?: string | null
          descrizione?: string | null
          id?: string
          is_storico?: boolean | null
          nome?: string
          ordine?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      permessi_portale: {
        Row: {
          can_access: boolean
          can_approve: boolean
          can_export: boolean
          id: string
          portale_id: string
          ruolo: string
        }
        Insert: {
          can_access?: boolean
          can_approve?: boolean
          can_export?: boolean
          id?: string
          portale_id: string
          ruolo: string
        }
        Update: {
          can_access?: boolean
          can_approve?: boolean
          can_export?: boolean
          id?: string
          portale_id?: string
          ruolo?: string
        }
        Relationships: [
          {
            foreignKeyName: "permessi_portale_portale_id_fkey"
            columns: ["portale_id"]
            isOneToOne: false
            referencedRelation: "portali"
            referencedColumns: ["id"]
          },
        ]
      }
      permessi_utente: {
        Row: {
          can_access: boolean
          id: string
          is_portal_admin: boolean
          override_access: boolean | null
          override_export: boolean | null
          portale_id: string
          utente_id: string
        }
        Insert: {
          can_access?: boolean
          id?: string
          is_portal_admin?: boolean
          override_access?: boolean | null
          override_export?: boolean | null
          portale_id: string
          utente_id: string
        }
        Update: {
          can_access?: boolean
          id?: string
          is_portal_admin?: boolean
          override_access?: boolean | null
          override_export?: boolean | null
          portale_id?: string
          utente_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permessi_utente_portale_id_fkey"
            columns: ["portale_id"]
            isOneToOne: false
            referencedRelation: "portali"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permessi_utente_utente_id_fkey"
            columns: ["utente_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      portali: {
        Row: {
          colore: string | null
          created_at: string
          descrizione: string | null
          icona: string | null
          id: string
          is_attivo: boolean
          labels_livelli: Json | null
          nome: string
          ordine: number
          slug: string
        }
        Insert: {
          colore?: string | null
          created_at?: string
          descrizione?: string | null
          icona?: string | null
          id?: string
          is_attivo?: boolean
          labels_livelli?: Json | null
          nome: string
          ordine?: number
          slug: string
        }
        Update: {
          colore?: string | null
          created_at?: string
          descrizione?: string | null
          icona?: string | null
          id?: string
          is_attivo?: boolean
          labels_livelli?: Json | null
          nome?: string
          ordine?: number
          slug?: string
        }
        Relationships: []
      }
      reparti: {
        Row: {
          attivo: boolean
          created_at: string
          descrizione: string | null
          id: string
          nome: string
          ordine: number
        }
        Insert: {
          attivo?: boolean
          created_at?: string
          descrizione?: string | null
          id?: string
          nome: string
          ordine?: number
        }
        Update: {
          attivo?: boolean
          created_at?: string
          descrizione?: string | null
          id?: string
          nome?: string
          ordine?: number
        }
        Relationships: []
      }
      report_blocchi: {
        Row: {
          configurazione: Json
          created_at: string
          id: string
          ordine: number
          report_id: string
          tipo: string
          titolo: string | null
        }
        Insert: {
          configurazione?: Json
          created_at?: string
          id?: string
          ordine?: number
          report_id: string
          tipo: string
          titolo?: string | null
        }
        Update: {
          configurazione?: Json
          created_at?: string
          id?: string
          ordine?: number
          report_id?: string
          tipo?: string
          titolo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_blocchi_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_config"
            referencedColumns: ["id"]
          },
        ]
      }
      report_config: {
        Row: {
          created_at: string
          created_by: string | null
          descrizione: string | null
          id: string
          is_attivo: boolean
          nome: string
          ordine: number
          updated_at: string
          visibilita_ruoli: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          descrizione?: string | null
          id?: string
          is_attivo?: boolean
          nome: string
          ordine?: number
          updated_at?: string
          visibilita_ruoli?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          descrizione?: string | null
          id?: string
          is_attivo?: boolean
          nome?: string
          ordine?: number
          updated_at?: string
          visibilita_ruoli?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "report_config_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      risposte: {
        Row: {
          created_at: string | null
          domanda_id: string | null
          id: string
          punteggio: number
          tipo: string
          updated_at: string | null
          utente_id: string | null
          valutatore_id: string | null
        }
        Insert: {
          created_at?: string | null
          domanda_id?: string | null
          id?: string
          punteggio: number
          tipo: string
          updated_at?: string | null
          utente_id?: string | null
          valutatore_id?: string | null
        }
        Update: {
          created_at?: string | null
          domanda_id?: string | null
          id?: string
          punteggio?: number
          tipo?: string
          updated_at?: string | null
          utente_id?: string | null
          valutatore_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risposte_domanda_id_fkey"
            columns: ["domanda_id"]
            isOneToOne: false
            referencedRelation: "domande"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risposte_utente_id_fkey"
            columns: ["utente_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risposte_valutatore_id_fkey"
            columns: ["valutatore_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      risposte_valutazione: {
        Row: {
          created_at: string
          id: string
          mansione_id: string | null
          note: string | null
          punteggio: number
          sessione_utente_id: string
          skill_id: string | null
          tipo: string
          valutatore_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mansione_id?: string | null
          note?: string | null
          punteggio: number
          sessione_utente_id: string
          skill_id?: string | null
          tipo: string
          valutatore_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mansione_id?: string | null
          note?: string | null
          punteggio?: number
          sessione_utente_id?: string
          skill_id?: string | null
          tipo?: string
          valutatore_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risposte_valutazione_mansione_id_fkey"
            columns: ["mansione_id"]
            isOneToOne: false
            referencedRelation: "mansioni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risposte_valutazione_sessione_utente_id_fkey"
            columns: ["sessione_utente_id"]
            isOneToOne: false
            referencedRelation: "sessioni_utente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risposte_valutazione_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risposte_valutazione_valutatore_id_fkey"
            columns: ["valutatore_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      ruoli_config: {
        Row: {
          colore: string
          created_at: string
          id: string
          is_system: boolean
          nome: string
          ordine: number
          slug: string
        }
        Insert: {
          colore?: string
          created_at?: string
          id?: string
          is_system?: boolean
          nome: string
          ordine?: number
          slug: string
        }
        Update: {
          colore?: string
          created_at?: string
          id?: string
          is_system?: boolean
          nome?: string
          ordine?: number
          slug?: string
        }
        Relationships: []
      }
      ruoli_professionali: {
        Row: {
          created_at: string
          descrizione: string | null
          id: string
          nome: string
          portale_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          descrizione?: string | null
          id?: string
          nome: string
          portale_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          descrizione?: string | null
          id?: string
          nome?: string
          portale_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ruoli_professionali_portale_id_fkey"
            columns: ["portale_id"]
            isOneToOne: false
            referencedRelation: "portali"
            referencedColumns: ["id"]
          },
        ]
      }
      scale_valutazione: {
        Row: {
          created_at: string | null
          id: string
          labels: Json
          max: number
          min: number
          nome: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          labels: Json
          max: number
          min: number
          nome: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          labels?: Json
          max?: number
          min?: number
          nome?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sessione_skills: {
        Row: {
          id: string
          sessione_id: string
          skill_id: string
        }
        Insert: {
          id?: string
          sessione_id: string
          skill_id: string
        }
        Update: {
          id?: string
          sessione_id?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessione_skills_sessione_id_fkey"
            columns: ["sessione_id"]
            isOneToOne: false
            referencedRelation: "sessioni_utente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessione_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      sessioni_utente: {
        Row: {
          anno: number
          certificato_url: string | null
          created_at: string
          data_programmata: string | null
          id: string
          note_admin: string | null
          orario: string | null
          ordine_profili: Json | null
          responsabile_id: string | null
          scala_id: string | null
          stato: string
          tipo_valutazione: string
          updated_at: string
          utente_id: string
        }
        Insert: {
          anno: number
          certificato_url?: string | null
          created_at?: string
          data_programmata?: string | null
          id?: string
          note_admin?: string | null
          orario?: string | null
          ordine_profili?: Json | null
          responsabile_id?: string | null
          scala_id?: string | null
          stato?: string
          tipo_valutazione?: string
          updated_at?: string
          utente_id: string
        }
        Update: {
          anno?: number
          certificato_url?: string | null
          created_at?: string
          data_programmata?: string | null
          id?: string
          note_admin?: string | null
          orario?: string | null
          ordine_profili?: Json | null
          responsabile_id?: string | null
          scala_id?: string | null
          stato?: string
          tipo_valutazione?: string
          updated_at?: string
          utente_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessioni_utente_responsabile_id_fkey"
            columns: ["responsabile_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessioni_utente_scala_id_fkey"
            columns: ["scala_id"]
            isOneToOne: false
            referencedRelation: "scale_valutazione"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessioni_utente_utente_id_fkey"
            columns: ["utente_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      sessioni_valutazione: {
        Row: {
          anno: number
          created_at: string | null
          id: string
          is_aperta: boolean | null
          scala_id: string | null
          updated_at: string | null
        }
        Insert: {
          anno: number
          created_at?: string | null
          id?: string
          is_aperta?: boolean | null
          scala_id?: string | null
          updated_at?: string | null
        }
        Update: {
          anno?: number
          created_at?: string | null
          id?: string
          is_aperta?: boolean | null
          scala_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessioni_valutazione_scala_id_fkey"
            columns: ["scala_id"]
            isOneToOne: false
            referencedRelation: "scale_valutazione"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          created_at: string
          descrizione: string | null
          id: string
          nome: string
          ordine: number
          parametro_radar_id: string | null
        }
        Insert: {
          created_at?: string
          descrizione?: string | null
          id?: string
          nome: string
          ordine?: number
          parametro_radar_id?: string | null
        }
        Update: {
          created_at?: string
          descrizione?: string | null
          id?: string
          nome?: string
          ordine?: number
          parametro_radar_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skills_parametro_radar_id_fkey"
            columns: ["parametro_radar_id"]
            isOneToOne: false
            referencedRelation: "parametri_radar"
            referencedColumns: ["id"]
          },
        ]
      }
      storico_punteggi: {
        Row: {
          anno: number
          created_at: string
          data_valutazione: string
          id: string
          note: string | null
          punteggio: number
          sessione_id: string | null
          tipo_fonte: string
          utente_id: string
        }
        Insert: {
          anno: number
          created_at?: string
          data_valutazione: string
          id?: string
          note?: string | null
          punteggio: number
          sessione_id?: string | null
          tipo_fonte?: string
          utente_id: string
        }
        Update: {
          anno?: number
          created_at?: string
          data_valutazione?: string
          id?: string
          note?: string | null
          punteggio?: number
          sessione_id?: string | null
          tipo_fonte?: string
          utente_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storico_punteggi_sessione_id_fkey"
            columns: ["sessione_id"]
            isOneToOne: false
            referencedRelation: "sessioni_utente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storico_punteggi_utente_id_fkey"
            columns: ["utente_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      utente_mansioni: {
        Row: {
          id: string
          mansione_id: string
          utente_id: string
        }
        Insert: {
          id?: string
          mansione_id: string
          utente_id: string
        }
        Update: {
          id?: string
          mansione_id?: string
          utente_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "utente_mansioni_mansione_id_fkey"
            columns: ["mansione_id"]
            isOneToOne: false
            referencedRelation: "mansioni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utente_mansioni_utente_id_fkey"
            columns: ["utente_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      utente_profili: {
        Row: {
          id: string
          ruolo_professionale_id: string
          utente_id: string
        }
        Insert: {
          id?: string
          ruolo_professionale_id: string
          utente_id: string
        }
        Update: {
          id?: string
          ruolo_professionale_id?: string
          utente_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "utente_profili_ruolo_professionale_id_fkey"
            columns: ["ruolo_professionale_id"]
            isOneToOne: false
            referencedRelation: "ruoli_professionali"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utente_profili_utente_id_fkey"
            columns: ["utente_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
      utenti: {
        Row: {
          cognome: string
          created_at: string | null
          data_assunzione: string | null
          email: string
          id: string
          nome: string
          reparto: string
          responsabile_id: string | null
          ruoli_aggiuntivi: string[] | null
          ruolo: string
          stato: string
          updated_at: string | null
          username: string | null
        }
        Insert: {
          cognome: string
          created_at?: string | null
          data_assunzione?: string | null
          email: string
          id?: string
          nome: string
          reparto: string
          responsabile_id?: string | null
          ruoli_aggiuntivi?: string[] | null
          ruolo: string
          stato?: string
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          cognome?: string
          created_at?: string | null
          data_assunzione?: string | null
          email?: string
          id?: string
          nome?: string
          reparto?: string
          responsabile_id?: string | null
          ruoli_aggiuntivi?: string[] | null
          ruolo?: string
          stato?: string
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "utenti_responsabile_id_fkey"
            columns: ["responsabile_id"]
            isOneToOne: false
            referencedRelation: "utenti"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_portale_livello: {
        Args: { p_slug: string; p_user_id: string }
        Returns: string
      }
      get_portali_utente: {
        Args: { p_user_id: string }
        Returns: {
          colore: string
          icona: string
          livello: string
          nome: string
          ordine: number
          portale_id: string
          slug: string
        }[]
      }
      is_valutazioni_admin: { Args: { p_user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
