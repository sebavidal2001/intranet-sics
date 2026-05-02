"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, AlertCircle } from "lucide-react";

interface SessioneDetailProps {
  sessione: {
    id: string;
    anno: number;
    is_aperta: boolean;
    scala: { nome: string } | null;
  };
}

export default function SessioneDetail({ sessione }: SessioneDetailProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleToggleStato = async () => {
    setLoading(true);
    setError("");

    const nuovoStato = !sessione.is_aperta;

    try {
      const response = await fetch("/api/portali/valutazioni/sessioni/sblocca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessioneId: sessione.id,
          isAperta: nuovoStato,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Errore");
      }

      alert(result.message);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessione Valutazione {sessione.anno}</CardTitle>
        <CardDescription>
          Scala: {sessione.scala?.nome || "Non assegnata"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stato */}
        <div className="flex items-center justify-between p-4 border border-border rounded-lg">
          <div className="flex items-center gap-3">
            {sessione.is_aperta ? (
              <Unlock className="h-6 w-6 text-success" />
            ) : (
              <Lock className="h-6 w-6 text-secondary" />
            )}
            <div>
              <p className="font-tenorite font-semibold text-text">
                Stato Sessione
              </p>
              <p className="text-sm text-text-muted">
                {sessione.is_aperta
                  ? "Gli utenti possono compilare le valutazioni"
                  : "Valutazioni bloccate"}
              </p>
            </div>
          </div>
          <Badge variant={sessione.is_aperta ? "success" : "secondary"}>
            {sessione.is_aperta ? "Aperta" : "Chiusa"}
          </Badge>
        </div>

        {/* Azione */}
        <div className="bg-primary-light border border-primary/20 p-4 rounded-lg">
          <p className="font-tenorite text-sm font-medium text-primary mb-2">
            {sessione.is_aperta ? "Chiudi Sessione" : "Sblocca Sessione"}
          </p>
          <p className="text-xs text-text-muted mb-4">
            {sessione.is_aperta
              ? "Chiudendo la sessione, gli utenti non potranno più compilare o modificare le valutazioni."
              : "Sbloccando la sessione, verrà inviata una email automatica a tutti gli utenti (esclusi admin) con l'invito a compilare la valutazione."}
          </p>
          <Button
            onClick={handleToggleStato}
            disabled={loading}
            variant={sessione.is_aperta ? "outline" : "default"}
          >
            {loading
              ? "Operazione in corso..."
              : sessione.is_aperta
              ? "Chiudi Sessione"
              : "Sblocca e Notifica Utenti"}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-danger/10 border border-danger text-danger px-4 py-3 rounded-lg">
            <AlertCircle className="h-5 w-5 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Info Email */}
        {!sessione.is_aperta && (
          <div className="bg-secondary-light border border-border p-4 rounded-lg">
            <p className="font-tenorite text-sm font-medium text-text mb-2">
              Email Automatica
            </p>
            <div className="text-xs text-text-muted space-y-1">
              <p>
                <strong>Destinatari:</strong> Tutti gli utenti (esclusi admin)
              </p>
              <p>
                <strong>Oggetto:</strong> Sessione Valutazione {sessione.anno} - Aperta
              </p>
              <p>
                <strong>Contenuto:</strong> Link diretto alla sezione valutazioni
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
