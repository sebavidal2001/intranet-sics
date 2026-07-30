"use client"

import { useEffect, useState } from "react"

/**
 * Input numerico "svuotabile" per le griglie di preventivazione.
 *
 * Problema risolto: con `value={n}` + `onChange={Number(e.target.value)}` non si
 * riesce a cancellare il contenuto — `Number("")` è 0, quindi il campo si
 * ri-popola subito con 0/1 e digitando resta lo zero davanti (es. "045").
 *
 * Comportamento:
 *  - si può svuotare completamente il campo (resta vuoto mentre si digita);
 *  - il clamp su min/max è applicato SOLO all'uscita dal campo (blur), non
 *    durante la digitazione, così si può riscrivere il numero da zero;
 *  - se il campo resta vuoto al blur si applica `emptyValue` (default: `min` o 0);
 *  - se il valore cambia dall'esterno (es. formule template) il campo si
 *    risincronizza, ma solo quando non è in editing.
 */
export function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
  title,
  emptyValue,
  placeholder,
  disabled,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  title?: string
  /** Valore applicato se il campo viene lasciato vuoto (default: `min` ?? 0). */
  emptyValue?: number
  placeholder?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string>(() => (Number.isFinite(value) ? String(value) : ""))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(Number.isFinite(value) ? String(value) : "")
  }, [value, editing])

  function handleChange(raw: string) {
    setDraft(raw)
    if (raw.trim() === "") return // campo vuoto: non propaghiamo, si decide al blur
    const n = Number(raw)
    if (Number.isFinite(n)) onChange(n) // nessun clamp qui: il clamp è al blur
  }

  function handleBlur() {
    setEditing(false)
    const fallback = emptyValue ?? min ?? 0
    if (draft.trim() === "") {
      setDraft(String(fallback))
      onChange(fallback)
      return
    }
    let n = Number(draft)
    if (!Number.isFinite(n)) n = fallback
    if (min !== undefined && n < min) n = min
    if (max !== undefined && n > max) n = max
    setDraft(String(n))
    onChange(n)
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      title={title}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      className={className}
    />
  )
}
