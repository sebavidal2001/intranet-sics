import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function calcolaDelta(attuale: number, precedente: number): number {
  if (precedente === 0) return 0;
  return Math.round(((attuale - precedente) / precedente) * 100);
}

export function formatData(data: string | Date): string {
  const d = typeof data === "string" ? new Date(data) : data;
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}
