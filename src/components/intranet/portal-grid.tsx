"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  LayoutGrid, BarChart2, Users, Settings, FileText, ClipboardList,
  TrendingUp, Award, Briefcase, BookOpen, Calendar, Home, Globe,
  Shield, Database, Bell, Star, Zap, Target, Layers,
  type LucideProps,
} from "lucide-react";

// Mappa esplicita: evita import * da lucide-react (~400 icone in bundle).
// Aggiungere qui se si usa una nuova icona nei portali.
const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  LayoutGrid, BarChart2, Users, Settings, FileText, ClipboardList,
  TrendingUp, Award, Briefcase, BookOpen, Calendar, Home, Globe,
  Shield, Database, Bell, Star, Zap, Target, Layers,
};

interface Portale {
  id: string;
  nome: string;
  slug: string;
  descrizione: string | null;
  icona: string | null;
  colore: string | null;
  ordine: number;
}

function DynamicIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = ICON_MAP[name] ?? LayoutGrid;
  return <Icon {...props} />;
}

export function PortalGrid({ portali }: { portali: Portale[] }) {
  if (portali.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted text-sm">
        Nessun portale disponibile per il tuo profilo.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {portali.map((portale, index) => (
        <motion.div
          key={portale.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.06, ease: "easeOut" }}
        >
          <Link
            href={`/${portale.slug}`}
            className="group flex flex-col p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150 h-full"
          >
            {/* Icona colorata */}
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform duration-150 group-hover:scale-105"
              style={{ backgroundColor: `${portale.colore ?? "#00a1be"}20` }}
            >
              <DynamicIcon
                name={portale.icona ?? "LayoutGrid"}
                className="w-5 h-5"
                style={{ color: portale.colore ?? "#00a1be" }}
              />
            </div>

            <h3 className="font-tenorite text-base text-text mb-1">
              {portale.nome}
            </h3>
            {portale.descrizione && (
              <p className="text-sm text-text-muted leading-relaxed line-clamp-2">
                {portale.descrizione}
              </p>
            )}

            <div className="mt-auto pt-3">
              <span
                className="text-xs font-tenorite"
                style={{ color: portale.colore ?? "#00a1be" }}
              >
                Apri →
              </span>
            </div>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
