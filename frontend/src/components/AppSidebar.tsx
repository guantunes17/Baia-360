import React from 'react'
import { addRipple } from '@/lib/ripple'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator,
} from '@/components/ui/sidebar'
import { MODULOS } from '@/lib/constants'
import { LogoBaia360 } from '@/components/LogoBaia360'
import { T } from '@/lib/theme'
import {
  Home,
  Package, Truck, Warehouse, ClipboardList, Users, Activity,
  PackageOpen, Receipt, BarChart3, LayoutDashboard, DollarSign,
} from 'lucide-react'

type LucideIcon = React.ComponentType<{ size?: number; color?: string }>

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

  const itemStyle = (isActive: boolean) => ({
    color: isActive ? T.text : T.textMuted,
    background: isActive ? T.goldSubtle : 'transparent',
    borderLeft: `2px solid ${isActive ? T.gold : 'transparent'}`,
    paddingLeft: 12,
    transition: 'all 0.15s ease',
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderRadius: 6,
  })

  const onEnter = (e: React.MouseEvent<HTMLButtonElement>, isActive: boolean) => {
    if (!isActive) {
      const el = e.currentTarget as HTMLElement
      el.style.transform = 'translateX(2px)'
      el.style.color = T.text
    }
  }
  const onLeave = (e: React.MouseEvent<HTMLButtonElement>, isActive: boolean) => {
    if (!isActive) {
      const el = e.currentTarget as HTMLElement
      el.style.transform = 'translateX(0)'
      el.style.color = T.textMuted
    }
  }

  const sidebarBg = {
    background: T.surface1,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  }

  return (
    <Sidebar className="border-r" style={{ ...sidebarBg, borderColor: T.border }}>

      <SidebarHeader className="px-4 py-5" style={sidebarBg}>
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

      <SidebarSeparator style={{ background: T.border }} />

      <SidebarContent style={sidebarBg}>

        {/* Home */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem key="home">
                <SidebarMenuButton
                  isActive={paginaAtiva === 'home'}
                  onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>, undefined, 0.12, 500); onNavegar('home') }}
                  className="cursor-pointer text-sm"
                  style={itemStyle(paginaAtiva === 'home')}
                  onMouseEnter={e => onEnter(e, paginaAtiva === 'home')}
                  onMouseLeave={e => onLeave(e, paginaAtiva === 'home')}
                >
                  <Home size={15} color={paginaAtiva === 'home' ? T.gold : T.textMuted} />
                  Home
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator style={{ background: T.border }} />

        {/* Operacional */}
        {temOperacional && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel style={{ color: T.accentBlue, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <LayoutDashboard size={12} color={T.accentBlue} />
                Operacional
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {modulos_operacional.map(m => {
                    const Icon = ICON_MAP[m.lucideIcon]
                    const isActive = paginaAtiva === m.key
                    return (
                      <SidebarMenuItem key={m.key}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>, undefined, 0.12, 500); onNavegar(m.key) }}
                          className="cursor-pointer text-sm"
                          style={itemStyle(isActive)}
                          onMouseEnter={e => onEnter(e, isActive)}
                          onMouseLeave={e => onLeave(e, isActive)}
                        >
                          {Icon && <Icon size={15} color={isActive ? T.gold : T.textMuted} />}
                          {m.titulo}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator style={{ background: T.border }} />
          </>
        )}

        {/* Financeiro */}
        {temFinanceiro && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel style={{ color: T.accentGreen, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <DollarSign size={12} color={T.accentGreen} />
                Financeiro
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {modulos_financeiro.map(m => {
                    const Icon = ICON_MAP[m.lucideIcon]
                    const isActive = paginaAtiva === m.key
                    return (
                      <SidebarMenuItem key={m.key}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>, undefined, 0.12, 500); onNavegar(m.key) }}
                          className="cursor-pointer text-sm"
                          style={itemStyle(isActive)}
                          onMouseEnter={e => onEnter(e, isActive)}
                          onMouseLeave={e => onLeave(e, isActive)}
                        >
                          {Icon && <Icon size={15} color={isActive ? T.gold : T.textMuted} />}
                          {m.titulo}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator style={{ background: T.border }} />
          </>
        )}

      </SidebarContent>

      <SidebarFooter style={sidebarBg}>
        <SidebarSeparator style={{ background: T.border }} />
        <p style={{ textAlign: 'center', fontSize: 11, padding: '8px 0', color: T.textDim }}>
          v1.0 · {new Date().toLocaleDateString('pt-BR')}
        </p>
      </SidebarFooter>

    </Sidebar>
  )
}
