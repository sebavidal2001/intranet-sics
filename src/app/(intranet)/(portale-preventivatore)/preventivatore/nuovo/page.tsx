import { Suspense } from "react";
import { NuovoView } from "@/components/portali/preventivatore/nuovo-view";

export const metadata = {
  title: "Nuovo Preventivo",
};

export default function NuovoPage() {
  return (
    <Suspense fallback={null}>
      <NuovoView />
    </Suspense>
  );
}
