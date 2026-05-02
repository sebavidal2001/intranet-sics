"use client"

import { cn } from "@/lib/utils"
import React, { useEffect, useRef, useState } from "react"

const SICS_PALETTE = [
  "#00a1be", // turchese
  "#747373", // grigio
  "#95c11f", // verde
  "#ee7326", // arancio
  "#e73331", // rosso
  "#c82381", // fucsia
]

interface MousePosition { x: number; y: number }

function useMousePosition(): MousePosition {
  const [pos, setPos] = useState<MousePosition>({ x: 0, y: 0 })
  useEffect(() => {
    const handler = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY })
    window.addEventListener("mousemove", handler)
    return () => window.removeEventListener("mousemove", handler)
  }, [])
  return pos
}

function hexToRgb(hex: string): number[] {
  hex = hex.replace("#", "")
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("")
  const n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

interface ParticlesProps {
  className?: string
  quantity?: number
  staticity?: number
  ease?: number
  size?: number
  refresh?: boolean
  colors?: string[]
  vx?: number
  vy?: number
}

type Circle = {
  x: number; y: number
  translateX: number; translateY: number
  size: number; alpha: number; targetAlpha: number
  dx: number; dy: number; magnetism: number
  rgb: number[]
}

export const Particles: React.FC<ParticlesProps> = ({
  className = "",
  quantity = 120,
  staticity = 50,
  ease = 40,
  size = 1.2,
  refresh = false,
  colors = SICS_PALETTE,
  vx = 0,
  vy = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ctx = useRef<CanvasRenderingContext2D | null>(null)
  const circles = useRef<Circle[]>([])
  const mouse = useRef({ x: 0, y: 0 })
  const canvasSize = useRef({ w: 0, h: 0 })
  const rafId = useRef<number>(0)
  const mousePos = useMousePosition()
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1

  // Aggiorna posizione mouse nel ref (no re-render)
  useEffect(() => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const { w, h } = canvasSize.current
    const x = mousePos.x - rect.left - w / 2
    const y = mousePos.y - rect.top - h / 2
    if (x < w / 2 && x > -w / 2 && y < h / 2 && y > -h / 2) {
      mouse.current = { x, y }
    }
  }, [mousePos])

  useEffect(() => {
    if (canvasRef.current) ctx.current = canvasRef.current.getContext("2d")
    resize()
    spawnAll()
    rafId.current = requestAnimationFrame(tick)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(rafId.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors])

  useEffect(() => {
    resize(); spawnAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const onResize = () => { resize(); spawnAll() }

  const resize = () => {
    if (!containerRef.current || !canvasRef.current || !ctx.current) return
    circles.current = []
    canvasSize.current.w = containerRef.current.offsetWidth
    canvasSize.current.h = containerRef.current.offsetHeight
    canvasRef.current.width = canvasSize.current.w * dpr
    canvasRef.current.height = canvasSize.current.h * dpr
    canvasRef.current.style.width = `${canvasSize.current.w}px`
    canvasRef.current.style.height = `${canvasSize.current.h}px`
    ctx.current.scale(dpr, dpr)
  }

  const newCircle = (): Circle => ({
    x: Math.random() * canvasSize.current.w,
    y: Math.random() * canvasSize.current.h,
    translateX: 0, translateY: 0,
    size: Math.random() * 1.5 + size,
    alpha: 0,
    targetAlpha: parseFloat((Math.random() * 0.55 + 0.1).toFixed(2)),
    dx: (Math.random() - 0.5) * 0.3,
    dy: (Math.random() - 0.5) * 0.3,
    magnetism: 0.2 + Math.random() * 5,
    rgb: hexToRgb(colors[Math.floor(Math.random() * colors.length)]),
  })

  const spawnAll = () => {
    if (!ctx.current) return
    ctx.current.clearRect(0, 0, canvasSize.current.w, canvasSize.current.h)
    circles.current = []
    for (let i = 0; i < quantity; i++) drawCircle(newCircle())
  }

  const drawCircle = (c: Circle, update = false) => {
    if (!ctx.current) return
    ctx.current.save()
    ctx.current.translate(c.translateX, c.translateY)
    ctx.current.beginPath()
    ctx.current.arc(c.x, c.y, c.size, 0, Math.PI * 2)
    ctx.current.fillStyle = `rgba(${c.rgb.join(",")},${c.alpha})`
    ctx.current.fill()
    ctx.current.restore()
    if (!update) circles.current.push(c)
  }

  const remap = (v: number, s1: number, e1: number, s2: number, e2: number) =>
    Math.max(0, ((v - s1) * (e2 - s2)) / (e1 - s1) + s2)

  const tick = () => {
    if (!ctx.current) { rafId.current = requestAnimationFrame(tick); return }
    ctx.current.clearRect(0, 0, canvasSize.current.w, canvasSize.current.h)

    circles.current.forEach((c, i) => {
      const edges = [
        c.x + c.translateX - c.size,
        canvasSize.current.w - c.x - c.translateX - c.size,
        c.y + c.translateY - c.size,
        canvasSize.current.h - c.y - c.translateY - c.size,
      ]
      const edge = Math.min(...edges)
      const fade = parseFloat(remap(edge, 0, 20, 0, 1).toFixed(2))

      if (fade > 1) {
        c.alpha = Math.min(c.alpha + 0.015, c.targetAlpha)
      } else {
        c.alpha = c.targetAlpha * fade
      }

      c.x += c.dx + vx
      c.y += c.dy + vy
      c.translateX += (mouse.current.x / (staticity / c.magnetism) - c.translateX) / ease
      c.translateY += (mouse.current.y / (staticity / c.magnetism) - c.translateY) / ease

      drawCircle(c, true)

      if (
        c.x < -c.size || c.x > canvasSize.current.w + c.size ||
        c.y < -c.size || c.y > canvasSize.current.h + c.size
      ) {
        circles.current.splice(i, 1)
        drawCircle(newCircle())
      }
    })

    rafId.current = requestAnimationFrame(tick)
  }

  return (
    <div className={cn("pointer-events-none", className)} ref={containerRef} aria-hidden="true">
      <canvas ref={canvasRef} className="size-full" />
    </div>
  )
}
