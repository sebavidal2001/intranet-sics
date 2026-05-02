"use client"

import React, { useEffect, useState } from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface NavItem {
  name: string
  url: string
  icon: LucideIcon
}

interface NavBarProps {
  items: NavItem[]
  className?: string
}

export function TubelightNavBar({ items, className }: NavBarProps) {
  const [activeTab, setActiveTab] = useState(items[0].name)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Sincronizza tab attivo con l'URL corrente
  useEffect(() => {
    const path = window.location.pathname
    const match = items.find((item) =>
      item.url === "/" ? path === "/" : path.startsWith(item.url)
    )
    if (match) setActiveTab(match.name)
  }, [items])

  return (
    <div className={cn("flex items-center gap-1 bg-white/20 border border-white/30 py-1 px-1 rounded-full", className)}>
      {items.map((item) => {
        const Icon = item.icon
        const isActive = activeTab === item.name

        return (
          <Link
            key={item.name}
            href={item.url}
            onClick={() => setActiveTab(item.name)}
            className={cn(
              "relative cursor-pointer text-sm font-tenorite px-5 py-2 rounded-full transition-colors duration-150",
              isActive ? "text-white" : "text-white/80 hover:text-white",
            )}
          >
            <span className="hidden md:inline">{item.name}</span>
            <span className="md:hidden">
              <Icon size={18} strokeWidth={2} />
            </span>

            {isActive && (
              <motion.div
                layoutId="tubelight-lamp"
                className="absolute inset-0 w-full bg-white/25 rounded-full -z-10"
                initial={false}
                transition={{ type: "spring", stiffness: 350, damping: 32 }}
              >
                {/* Luce tubelight sopra */}
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-white rounded-t-full">
                  <div className="absolute w-14 h-6 bg-white/30 rounded-full blur-md -top-2 -left-3" />
                  <div className="absolute w-8 h-5 bg-white/25 rounded-full blur-md -top-1" />
                  <div className="absolute w-4 h-3 bg-white/35 rounded-full blur-sm top-0 left-2" />
                </div>
              </motion.div>
            )}
          </Link>
        )
      })}
    </div>
  )
}
