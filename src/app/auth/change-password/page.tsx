"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Particles } from "@/components/ui/particles";
import Image from "next/image";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }
    if (newPassword.length < 8) {
      setError("La nuova password deve essere di almeno 8 caratteri.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Supabase permette di aggiornare la password dell'utente autenticato
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError("Errore durante il cambio password. Riprova.");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
    setTimeout(() => router.push("/"), 2000);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-bg-page overflow-hidden">
      <Particles className="absolute inset-0 z-0" quantity={40} staticity={40} ease={60} size={2.5} />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="bg-bg/90 backdrop-blur-sm rounded-2xl shadow-card border border-border p-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <Image src="/logo/sics-logo.png" alt="SICS Logo" width={140} height={42} priority className="object-contain" />
          </div>

          <h1 className="font-tenorite text-xl text-center text-text mb-1">Cambia password</h1>
          <p className="text-center text-text-muted text-sm mb-6">Inserisci la nuova password</p>

          {success ? (
            <div className="bg-success/10 border border-success/30 text-success px-4 py-4 rounded-lg text-sm text-center">
              Password aggiornata con successo. Reindirizzamento in corso…
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Password attuale */}
              <div>
                <label htmlFor="current" className="block font-tenorite text-sm font-medium text-text mb-1.5">
                  Password attuale
                </label>
                <div className="relative">
                  <input
                    id="current"
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 pr-11 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors duration-100 bg-bg text-text"
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors">
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Nuova password */}
              <div>
                <label htmlFor="new" className="block font-tenorite text-sm font-medium text-text mb-1.5">
                  Nuova password
                </label>
                <div className="relative">
                  <input
                    id="new"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-2.5 pr-11 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors duration-100 bg-bg text-text"
                    placeholder="Min. 8 caratteri"
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Conferma */}
              <div>
                <label htmlFor="confirm" className="block font-tenorite text-sm font-medium text-text mb-1.5">
                  Conferma nuova password
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors duration-100 bg-bg text-text"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary-dark text-white font-tenorite py-2.5 px-4 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Salvataggio…" : "Aggiorna password"}
              </button>
            </form>
          )}

          <div className="mt-5 text-center">
            <button
              onClick={() => router.push("/auth/login")}
              className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Torna al login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
