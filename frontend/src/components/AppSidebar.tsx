import React from 'react'
import { addRipple } from '@/lib/ripple'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
} from '@/components/ui/sidebar'
import { MODULOS } from '@/lib/constants'
import { LogoBaia360 } from '@/components/LogoBaia360'
import { T } from '@/lib/theme'
import { glass } from '@/lib/glass'
import {
  Home,
  Package, Truck, Warehouse, ClipboardList, Users, Activity,
  PackageOpen, Receipt, BarChart3, LayoutDashboard, DollarSign,
} from 'lucide-react'

type LucideIcon = React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>

const ICON_MAP: Record<string, LucideIcon> = {
  Package, Truck, Warehouse, ClipboardList, Users, Activity,
  PackageOpen, Receipt, BarChart3,
}

interface Props {
  paginaAtiva: string
  onNavegar: (key: string) => void
  perfil: string
  modulosPermitidos?: string[]
}

export function AppSidebar({ paginaAtiva, onNavegar, perfil, modulosPermitidos }: Props) {
  const isAdmin = perfil === 'admin'

  const modulos_operacional = MODULOS.filter(m =>
    m.grupo === 'operacional' && (isAdmin || !modulosPermitidos || modulosPermitidos.includes(m.key))
  )
  const modulos_financeiro = MODULOS.filter(m =>
    m.grupo === 'financeiro' && (isAdmin || !modulosPermitidos || modulosPermitidos.includes(m.key))
  )

  const temOperacional = modulos_operacional.length > 0
  const temFinanceiro  = modulos_financeiro.length > 0

  const glassStyle = glass(0.45, 20)

  const containerStyle: React.CSSProperties = {
    ...glassStyle,
    boxShadow: '4px 0 16px rgba(0, 0, 0, 0.3), 1px 0 4px rgba(0, 0, 0, 0.2)',
  }

  const renderSeparator = () => (
    <div style={{
      height: 1,
      background: `linear-gradient(90deg, transparent, ${T.border}, transparent)`,
      margin: '8px 12px',
    }} />
  )

  const renderGroupLabel = (color: string, Icon: LucideIcon, label: string) => (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      color,
      padding: '6px 14px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}>
      <Icon size={12} color={color} />
      {label}
    </span>
  )

  const renderMenuItem = (key: string, Icon: LucideIcon | null, label: string) => {
    const isActive = paginaAtiva === key
    return (
      <div
        key={key}
        onClick={e => { addRipple(e, T.gold, 0.12, 500); onNavegar(key) }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 14px',
          borderRadius: 8,
          cursor: 'pointer',
          background: isActive ? 'rgba(240, 180, 41, 0.08)' : 'transparent',
          transition: 'all 0.2s ease',
          position: 'relative',
          overflow: 'hidden',
        }}
        onMouseEnter={e => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'
        }}
        onMouseLeave={e => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        {isActive && (
          <div style={{
            position: 'absolute',
            left: 0,
            top: '20%',
            height: '60%',
            width: 3,
            borderRadius: '0 3px 3px 0',
            background: T.gold,
            boxShadow: `0 0 8px ${T.gold}44`,
          }} />
        )}
        {Icon && (
          <Icon
            size={16}
            color={isActive ? T.gold : T.textMuted}
            style={{ flexShrink: 0 }}
          />
        )}
        <span style={{
          fontSize: 13,
          color: isActive ? T.text : T.textMuted,
          fontWeight: isActive ? 600 : 400,
          transition: 'all 0.2s',
        }}>
          {label}
        </span>
      </div>
    )
  }

  return (
    <Sidebar className="border-r" style={{ ...containerStyle, borderColor: T.border }}>

      <SidebarHeader className="px-4 py-5" style={glassStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: '80%', height: 2, borderRadius: 1, marginBottom: 10,
            background: `linear-gradient(90deg, transparent, ${T.gold}, transparent)`,
          }} />
          <LogoBaia360 size={40} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, textAlign: 'center', lineHeight: 1.35, marginTop: 4 }}>
            Central de<br />Relatórios
          </span>
        </div>
      </SidebarHeader>

      {renderSeparator()}

      <SidebarContent style={glassStyle}>
        <div style={{ padding: '4px 8px' }}>

          {renderMenuItem('home', Home, 'Home')}

          {renderSeparator()}

          {temOperacional && (
            <>
              {renderGroupLabel(T.accentBlue, LayoutDashboard, 'Operacional')}
              {modulos_operacional.map(m => renderMenuItem(m.key, ICON_MAP[m.lucideIcon] ?? null, m.titulo))}
              {renderSeparator()}
            </>
          )}

          {temFinanceiro && (
            <>
              {renderGroupLabel(T.accentGreen, DollarSign, 'Financeiro')}
              {modulos_financeiro.map(m => renderMenuItem(m.key, ICON_MAP[m.lucideIcon] ?? null, m.titulo))}
              {renderSeparator()}
            </>
          )}

        </div>
      </SidebarContent>

      <SidebarFooter style={glassStyle}>
        {renderSeparator()}
        <p style={{ textAlign: 'center', fontSize: 11, padding: '8px 0', color: T.textDim }}>
          v1.0 · {new Date().toLocaleDateString('pt-BR')}
        </p>
      </SidebarFooter>

    </Sidebar>
  )
}
