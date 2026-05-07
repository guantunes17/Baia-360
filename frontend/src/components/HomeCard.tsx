import React from 'react'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { addRipple } from '@/lib/ripple'
import {
  Package, Truck, Warehouse, ClipboardList, Users, Activity,
  PackageOpen, Receipt, BarChart3,
} from 'lucide-react'

type LucideIcon = React.ComponentType<{ size?: number; color?: string }>

const ICON_MAP: Record<string, LucideIcon> = {
  Package, Truck, Warehouse, ClipboardList, Users, Activity,
  PackageOpen, Receipt, BarChart3,
}

interface Props {
  lucideIcon?: string
  icone: string
  titulo: string
  descricao: string
  cor: string
  ultimaExtracao?: string
  onAcessar: () => void
}


export function HomeCard({ lucideIcon, icone, titulo, descricao, cor, ultimaExtracao, onAcessar }: Props) {
  const Icon = lucideIcon ? ICON_MAP[lucideIcon] : null

  return (
    <div
      onClick={e => { addRipple(e); onAcessar() }}
      style={{
        ...glass(0.35, 20),
        boxShadow: neoShadow,
        borderRadius: 14,
        borderColor: `${cor}25`,
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}55`
        el.style.boxShadow = `${neoShadow}, 0 0 24px ${cor}14`
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}25`
        el.style.boxShadow = neoShadow
        el.style.transform = 'translateY(0)'
      }}
    >
      {/* Accent top bar */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${cor}88, ${cor}, ${cor}44)` }} />

      <div style={{ padding: '20px 18px' }}>
        {/* Icon and title */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, marginBottom: 16 }}>
          {Icon ? (
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: `${cor}14`,
              border: `1px solid ${cor}28`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 14px ${cor}14`,
            }}>
              <Icon size={22} color={cor} />
            </div>
          ) : (
            <span style={{ fontSize: 32 }}>{icone}</span>
          )}
          <h3 style={{ fontSize: 13, fontWeight: 700, color: T.text, margin: 0, lineHeight: 1.3 }}>
            {titulo}
          </h3>
          <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>{descricao}</p>
        </div>

        {/* Separator */}
        <div style={{ height: 1, background: T.border, margin: '12px 0' }} />

        {/* Última extração */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: T.textMuted }}>Última extração</span>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 5,
            background: ultimaExtracao && ultimaExtracao !== '—' ? `${cor}14` : 'transparent',
            border: `0.5px solid ${ultimaExtracao && ultimaExtracao !== '—' ? `${cor}40` : T.border}`,
            color: ultimaExtracao && ultimaExtracao !== '—' ? cor : T.textMuted,
          }}>
            {ultimaExtracao || '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
