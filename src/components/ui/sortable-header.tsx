"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

interface SortableHeaderProps {
  column: string;
  label: string;
  currentSort: string | null;
  currentDir: "asc" | "desc";
  className?: string;
}

export function SortableHeader({
  column,
  label,
  currentSort,
  currentDir,
  className,
}: SortableHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleSort = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentSort === column) {
      params.set("dir", currentDir === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", column);
      params.set("dir", "asc");
    }
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams, column, currentSort, currentDir]);

  const isActive = currentSort === column;

  return (
    <button
      type="button"
      onClick={handleSort}
      className={cn(
        "inline-flex items-center gap-1 font-tenorite text-xs uppercase tracking-wide transition-colors select-none",
        isActive ? "text-primary" : "text-text-muted hover:text-text",
        className
      )}
    >
      {label}
      {isActive ? (
        currentDir === "asc" ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )
      ) : (
        <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
      )}
    </button>
  );
}

