import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "SICS - Piattaforma Valutazione Personale",
  description: "Sistema di valutazione e analisi del personale SICS - Create to Solve",
  icons: {
    icon: "/logo/sics-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="antialiased">{children}</body>
    </html>
  );
}
