import React from 'react'
import { T } from './theme'

export function addRipple(
  e: React.MouseEvent<HTMLElement>,
  color: string = T.gold,
  opacity: number = 0.3,
  duration: number = 600,
) {
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const size = Math.max(rect.width, rect.height) * 2.5
  const ripple = document.createElement('span')
  ripple.style.cssText = `
    position: absolute;
    width: ${size}px;
    height: ${size}px;
    left: ${x - size / 2}px;
    top: ${y - size / 2}px;
    background: radial-gradient(circle, ${color} 0%, transparent 70%);
    opacity: ${opacity};
    border-radius: 50%;
    pointer-events: none;
    transform: scale(0);
    animation: ripple-expand ${duration}ms ease-out forwards;
    z-index: 1;
  `
  const pos = getComputedStyle(el).position
  if (pos === 'static' || pos === '') el.style.position = 'relative'
  el.style.overflow = 'hidden'
  el.appendChild(ripple)
  setTimeout(() => ripple.remove(), duration + 100)
}
