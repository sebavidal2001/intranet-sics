"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface NavbarProps {
  user: {
    nome: string;
    cognome: string;
    ruolo: string;
  };
}

export function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const getRuoloLabel = (ruolo: string) => {
    const labels = {
      admin: "Amministratore",
      responsabile: "Responsabile",
      collaboratore: "Collaboratore",
    };
    return labels[ruolo as keyof typeof labels];
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-bg shadow-sm">
      <div className="flex h-16 items-center px-6">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center">
          <Image
            src="/logo/sics-logo.png"
            alt="SICS"
            width={144}
            height={36}
            priority
            className="object-contain"
          />
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <User className="h-4 w-4" />
              <span className="font-tenorite">
                {user.nome} {user.cognome}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-tenorite text-text">
                {user.nome} {user.cognome}
              </p>
              <p className="text-xs text-text-muted">
                {getRuoloLabel(user.ruolo)}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Esci</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
