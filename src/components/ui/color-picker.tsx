"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { HexColorPicker } from "react-colorful";
import { Pipette } from "lucide-react";

export const COLORI_SICS = [
  "#00A1BE", "#007A91", "#95C11F", "#EE7326",
  "#E73331", "#C82381", "#747373", "#005F73",
  "#0A9396", "#94D2BD", "#E9D8A6", "#1A202C",
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  error?: string;
  label?: string;
  required?: boolean;
}

export function ColorPicker({ value, onChange, error, label, required }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [supportsEyeDropper, setSupportsEyeDropper] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const safeHex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#00A1BE";

  useEffect(() => {
    setSupportsEyeDropper(typeof window !== "undefined" && "EyeDropper" in window);
  }, []);

  // Chiudi il popup cliccando fuori
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleHexInput = (v: string) => {
    const cleaned = v.startsWith("#") ? v : `#${v}`;
    onChange(cleaned.toUpperCase());
  };

  const handleEyeDropper = useCallback(async () => {
    try {
      // @ts-expect-error EyeDropper non ancora nei tipi TS
      const picker = new window.EyeDropper();
      const result = await picker.open();
      onChange(result.sRGBHex.toUpperCase());
      setOpen(false);
    } catch {
      // utente ha annullato
    }
  }, [onChange]);

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block font-tenorite text-sm text-text">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}

      {/* Trigger: swatch + hex input sempre visibili */}
      <div className="relative flex items-center gap-2" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-9 h-9 rounded-lg border-2 shrink-0 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/30"
          style={{
            backgroundColor: safeHex,
            borderColor: open ? "#00a1be" : "var(--color-border, #e2e8f0)",
          }}
          title="Apri selettore colore"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => handleHexInput(e.target.value)}
          placeholder="#00A1BE"
          maxLength={7}
          className="flex-1 h-9 rounded-md border border-border bg-bg px-3 py-2 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors uppercase"
        />

        {/* Popup color picker */}
        {open && (
          <div
            className="absolute z-50 mt-1 p-3 bg-bg rounded-xl border border-border shadow-lg space-y-3 w-[220px]"
            style={{ top: "calc(100% + 4px)", left: 0 }}
          >
            {/* Gradient picker (react-colorful) */}
            <HexColorPicker
              color={safeHex}
              onChange={(c) => onChange(c.toUpperCase())}
              style={{ width: "100%", height: "160px" }}
            />

            {/* Hex input + pipetta (dentro il picker) */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={value}
                onChange={(e) => handleHexInput(e.target.value)}
                maxLength={7}
                placeholder="#00A1BE"
                className="flex-1 h-8 rounded-md border border-border bg-bg px-2 text-xs font-mono tracking-wider focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-colors uppercase"
              />
              {supportsEyeDropper && (
                <button
                  type="button"
                  onClick={handleEyeDropper}
                  className="h-8 w-8 flex items-center justify-center rounded-md border border-border bg-bg text-text-muted hover:text-primary hover:border-primary transition-colors shrink-0"
                  title="Preleva colore dallo schermo"
                >
                  <Pipette className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Palette SICS */}
            <div>
              <p className="text-[10px] text-text-muted font-tenorite mb-1.5">Palette SICS</p>
              <div className="flex flex-wrap gap-1.5">
                {COLORI_SICS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { onChange(c); setOpen(false); }}
                    className="w-5 h-5 rounded border-2 transition-transform hover:scale-110 focus:outline-none"
                    style={{
                      backgroundColor: c,
                      borderColor: safeHex.toUpperCase() === c ? "#1a202c" : "transparent",
                    }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}
