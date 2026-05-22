"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { usernameToEmailCandidates } from "@/lib/auth/username";
import { Particles } from "@/components/ui/particles";
import { Eye, EyeOff } from "lucide-react";
import { CambioPasswordModal } from "@/components/auth/cambio-password-modal";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Modale cambio password: { forzato } = primo accesso obbligatorio; null = chiusa
  const [modaleCambioPwd, setModaleCambioPwd] = useState<{ forzato: boolean; identificativo?: string } | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    // Durante la migrazione email proviamo entrambi i domini (legacy + nuovo)
    const candidates = usernameToEmailCandidates(username);

    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"] | null = null;
    let authError: Error | null = null;

    for (const email of candidates) {
      const res = await supabase.auth.signInWithPassword({ email, password });
      if (!res.error && res.data.user) {
        data = res.data;
        authError = null;
        break;
      }
      authError = res.error ?? new Error("login failed");
    }

    if (authError || !data?.user) {
      setError("Credenziali non valide. Riprova.");
      setLoading(false);
      return;
    }

    // Verifica che l'utente esista nella tabella utenti
    const { data: userProfile, error: profileError } = await supabase
      .from("utenti")
      .select("id, ruolo, primo_accesso")
      .eq("id", data.user.id)
      .single();

    if (profileError || !userProfile) {
      setError("Profilo utente non trovato. Contatta l'amministratore.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    // Primo accesso: l'utente deve sostituire la password assegnata.
    if ((userProfile as { primo_accesso?: boolean }).primo_accesso) {
      setLoading(false);
      setModaleCambioPwd({ forzato: true, identificativo: data.user.email ?? username });
      return;
    }

    window.location.href = "/";
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-bg-page overflow-hidden">
      {/* Background animato */}
      <Particles
        className="absolute inset-0 z-0"
        quantity={60}
        staticity={40}
        ease={60}
        size={2.5}
      />

      {/* Card login */}
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="bg-bg/90 backdrop-blur-sm rounded-2xl shadow-card border border-border p-8">
          {/* Logo */}
          <div className="flex flex-col items-center gap-1.5 mb-8">
            <Image
              src="/logo/sics-logo.png"
              alt="SICS"
              width={130}
              height={40}
              className="object-contain"
              style={{ filter: "brightness(0) saturate(100%) invert(49%) sepia(73%) saturate(4135%) hue-rotate(163deg) brightness(95%) contrast(101%)" }}
              priority
            />
            <span className="text-xs text-text-muted tracking-widest uppercase font-tenorite">
              Create to Solve
            </span>
          </div>

          <h1 className="font-tenorite text-2xl text-center text-text mb-1">
            Benvenuto
          </h1>
          <p className="text-center text-text-muted text-sm mb-8">
            Accedi alla intranet aziendale
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block font-tenorite text-sm font-medium text-text mb-1.5"
              >
                Username o email
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors duration-100 bg-bg text-text placeholder:text-text-muted"
                placeholder="nome.cognome"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block font-tenorite text-sm font-medium text-text mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full px-4 py-2.5 pr-11 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors duration-100 bg-bg text-text"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
                  aria-label={showPassword ? "Nascondi password" : "Mostra password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Errore */}
            {error && (
              <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark text-white font-tenorite py-2.5 px-4 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Accesso in corso..." : "Accedi"}
            </button>
          </form>

          {/* Cambio password */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() =>
                setModaleCambioPwd({ forzato: false, identificativo: username.trim() || undefined })
              }
              className="text-sm text-primary hover:text-primary-dark transition-colors"
            >
              Cambia password
            </button>
          </div>

          <p className="text-center text-text-muted text-xs mt-6">
            SICS © {new Date().getFullYear()} · Create to Solve
          </p>
        </div>
      </div>

      {/* Modale cambio password (primo accesso o volontaria) */}
      {modaleCambioPwd && (
        <CambioPasswordModal
          forzato={modaleCambioPwd.forzato}
          identificativoIniziale={modaleCambioPwd.identificativo}
          onClose={modaleCambioPwd.forzato ? undefined : () => setModaleCambioPwd(null)}
          onSuccess={async () => {
            // Dopo il cambio password si rientra dal login con la nuova password
            // (cambiare la password puo invalidare la sessione corrente).
            const supabase = createClient();
            await supabase.auth.signOut();
            setModaleCambioPwd(null);
            setPassword("");
            window.location.href = "/auth/login";
          }}
        />
      )}
    </div>
  );
}
