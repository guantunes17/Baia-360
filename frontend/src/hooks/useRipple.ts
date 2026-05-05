import { useRef, useCallback, useEffect } from 'react'
import { T } from '../lib/theme'

export function useRipple<E extends HTMLElement = HTMLElement>() {
  const ref = useRef<E>(null)

  const handleClick = useCallback((e: MouseEvent) => {
    const element = ref.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = Math.max(rect.width, rect.height) * 2

    const ripple = document.createElement('span')
    ripple.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      left: ${x - size / 2}px;
      top: ${y - size / 2}px;
      background: ${T.gold};
      opacity: 0.15;
      border-radius: 50%;
      pointer-events: none;
      transform: scale(0);
      animation: ripple-expand 500ms ease-out forwards;
      z-index: 0;
    `

    const position = getComputedStyle(element).position
    if (!['relative', 'absolute', 'fixed', 'sticky'].includes(position)) {
      element.style.position = 'relative'
    }
    element.style.overflow = 'hidden'
    element.appendChild(ripple)

    setTimeout(() => ripple.remove(), 600)
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.addEventListener('click', handleClick as EventListener)
    return () => element.removeEventListener('click', handleClick as EventListener)
  }, [handleClick])

  return ref
}
