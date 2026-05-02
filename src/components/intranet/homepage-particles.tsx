"use client";

import dynamic from "next/dynamic";

// Caricamento lazy: le particles sono pesanti (canvas + requestAnimationFrame)
// e servono solo sulla homepage, non su tutte le pagine intranet
const Particles = dynamic(
  () => import("@/components/ui/particles").then((m) => m.Particles),
  { ssr: false }
);

export function HomepageParticles() {
  return (
    <Particles
      className="fixed inset-0 z-0 pointer-events-none"
      quantity={50}
      staticity={60}
      ease={70}
      size={2.5}
    />
  );
}
