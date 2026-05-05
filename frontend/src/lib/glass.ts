import type { CSSProperties } from 'react'
import { T } from './theme'

export function glass(opacity: number = 0.35, blur: number = 20): CSSProperties {
  return {
    background: `rgba(14, 22, 45, ${opacity})`,
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    border: `1px solid ${T.border}`,
  }
}

export const neoShadow = "4px 4px 12px rgba(0,0,0,0.5), -2px -2px 8px rgba(240,180,41,0.03)"

export const neoShadowInset = "inset 2px 2px 6px rgba(0,0,0,0.4), inset -1px -1px 4px rgba(240,180,41,0.02)"

export const glassHover: CSSProperties = {
  borderColor: T.borderHover,
}
