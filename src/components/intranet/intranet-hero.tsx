"use client"

import { LazyMotion, domAnimation, m } from "framer-motion"
import Image from "next/image"
import { useState } from "react"

interface IntranetHeroProps {
  nome: string
}

export function IntranetHero({ nome }: IntranetHeroProps) {
  const ora = new Date().getHours()
  const saluto = ora < 12 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera"
  const [imgError, setImgError] = useState(false)

  return (
    <LazyMotion features={domAnimation}>
      <section
        className="relative rounded-2xl overflow-visible h-[350px] flex items-center"
        style={{ backgroundColor: "#00A1BE" }}
      >
        {/* Cerchio decorativo in alto a destra */}
        <div className="absolute top-[-15%] right-[-4%] w-80 h-80 rounded-full bg-white/10 pointer-events-none" />
        {/* Cerchio più piccolo in basso a sinistra */}
        <div className="absolute bottom-[-20%] left-[8%] w-48 h-48 rounded-full bg-white/8 pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between w-full px-8 md:px-14 py-8 gap-8">
          {/* Testo */}
          <div className="flex-1 min-w-0">
            <m.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="text-xs font-tenorite tracking-[0.2em] uppercase text-white/70 mb-4"
            >
              Intranet aziendale · SICS
            </m.p>

            <m.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
              className="font-tenorite leading-tight"
            >
              {nome && (
                <span className="block text-white/80 text-2xl md:text-3xl mb-1">
                  {saluto}, {nome}
                </span>
              )}
              <span className="block text-4xl md:text-6xl text-white drop-shadow-sm">
                Create to Solve
              </span>
            </m.h1>

            <m.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.18, ease: "easeOut" }}
              className="mt-4 text-white/75 text-base max-w-sm"
            >
              Accedi ai tuoi portali e strumenti aziendali da un unico posto.
            </m.p>

            <m.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "4rem" }}
              transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
              className="mt-6 h-0.5 rounded-full bg-white/40"
            />
          </div>

          {/* Destra: box bianco come sfondo + immagine sopra */}
          <m.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: "easeOut" }}
            className="hidden md:block shrink-0 relative w-[500px] h-[420px]"
          >
            {!imgError ? (
              <Image
                src="/images/hero-intranet.png"
                alt="Intranet SICS"
                fill
                className="object-contain drop-shadow-2xl"
                onError={() => setImgError(true)}
                priority
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <p className="text-white/50 text-xs font-tenorite text-center px-4 leading-relaxed">
                  public/images/<br />hero-intranet.png
                </p>
              </div>
            )}
          </m.div>
        </div>
      </section>
    </LazyMotion>
  )
}
