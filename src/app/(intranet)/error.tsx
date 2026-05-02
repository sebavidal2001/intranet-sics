"use client";

import { useEffect } from "react";

export default function IntranetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Intranet error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center">
        <svg className="w-6 h-6 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-tenorite font-semibold text-text">Si è verificato un errore</h2>
      <p className="text-text-muted text-sm max-w-md">
        Impossibile caricare la pagina. Potrebbe essere un problema temporaneo.
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
      >
        Riprova
      </button>
    </div>
  );
}
