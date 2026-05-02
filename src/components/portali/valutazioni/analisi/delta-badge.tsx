"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeltaBadgeProps {
  delta: number;
  className?: string;
  showIcon?: boolean;
  showPercentage?: boolean;
}

export function DeltaBadge({
  delta,
  className,
  showIcon = true,
  showPercentage = true,
}: DeltaBadgeProps) {
  const isPositive = delta > 0;
  const isNegative = delta < 0;
  const isNeutral = delta === 0;

  const color = isPositive
    ? "text-success"
    : isNegative
    ? "text-danger"
    : "text-secondary";

  const bgColor = isPositive
    ? "bg-success/10"
    : isNegative
    ? "bg-danger/10"
    : "bg-secondary-light";

  const Icon = isPositive
    ? TrendingUp
    : isNegative
    ? TrendingDown
    : Minus;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium text-sm transition-badge",
        bgColor,
        color,
        className
      )}
    >
      {showIcon && <Icon className="h-4 w-4" />}
      <span>
        {isPositive && "+"}
        {delta.toFixed(1)}
        {showPercentage && "%"}
      </span>
    </div>
  );
}
