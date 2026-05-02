"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export default function PrintTrigger() {
  return (
    <Button onClick={() => window.print()} variant="default">
      <Printer className="w-4 h-4 mr-2" />
      Stampa / Salva PDF
    </Button>
  );
}
