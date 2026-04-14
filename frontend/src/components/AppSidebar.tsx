import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator,
} from '@/components/ui/sidebar'
import { MODULOS } from '@/lib/constants'
import { LogoBaia360 } from '@/components/LogoBaia360'

interface Props {
  paginaAtiva: string
  onNavegar: (key: string) => void
  perfil: string
}

export function AppSidebar({ paginaAtiva, onNavegar, perfil }: Props) {
  const isAdmin      = perfil === 'admin'
  const isAnalista   = perfil === 'analista'
  const isFinanceiro = perfil === 'financeiro'

  const temOperacional = isAdmin || isAnalista
  const temFinanceiro  = isAdmin || isFinanceiro
  const temAdmin       = isAdmin

  const modulos_operacional = MODULOS.filter(m => m.grupo === 'operacional')
  const modulos_financeiro  = MODULOS.filter(m => m.grupo === 'financeiro')

  const menuItem = (key: string, label: string) => (
    <SidebarMenuItem key={key}>
      <SidebarMenuButton
        isActive={paginaAtiva === key}
        onClick={() => onNavegar(key)}
        className="cursor-pointer text-sm"
        style={{
          color: paginaAtiva === key ? '#e2e8f0' : '#8892a4',
          background: paginaAtiva === key ? '#1e2235' : 'transparent',
          transition: 'transform 0.15s ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateX(2px)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateX(0)' }}
      >
        {label}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )

  return (
    <Sidebar className="border-r border-[#2d3148]" style={{ background: '#13161f' }}>

      <SidebarHeader className="px-4 py-5" style={{ background: '#13161f' }}>
        <div className="flex flex-col items-center gap-1">
          <div className="w-full h-1 rounded mb-3" style={{ background: '#4f8ef7' }} />
          <LogoBaia360 size={40} />
          <span className="text-sm font-bold text-center leading-tight" style={{ color: '#e2e8f0' }}>
            Central de<br />Relatórios
          </span>
        </div>
      </SidebarHeader>

      <SidebarSeparator style={{ background: '#2d3148' }} />

      <SidebarContent style={{ background: '#13161f' }}>

        {/* Home */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItem('home', '🏠  Home')}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator style={{ background: '#2d3148' }} />

        {/* Operacional */}
        {temOperacional && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel style={{ color: '#4f8ef7', fontWeight: 700 }}>
                📊 Operacional
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {modulos_operacional.map(m => (
                    <SidebarMenuItem key={m.key}>
                      <SidebarMenuButton
                        isActive={paginaAtiva === m.key}
                        onClick={() => onNavegar(m.key)}
                        className="cursor-pointer text-sm"
                        style={{
                          color: paginaAtiva === m.key ? '#e2e8f0' : '#8892a4',
                          background: paginaAtiva === m.key ? '#1e2235' : 'transparent',
                          transition: 'transform 0.15s ease',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateX(2px)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateX(0)' }}
                      >
                        {m.icone}  {m.titulo}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator style={{ background: '#2d3148' }} />
          </>
        )}

        {/* Financeiro */}
        {temFinanceiro && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel style={{ color: '#10b981', fontWeight: 700 }}>
                💰 Financeiro
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {modulos_financeiro.map(m => (
                    <SidebarMenuItem key={m.key}>
                      <SidebarMenuButton
                        isActive={paginaAtiva === m.key}
                        onClick={() => onNavegar(m.key)}
                        className="cursor-pointer text-sm"
                        style={{
                          color: paginaAtiva === m.key ? '#e2e8f0' : '#8892a4',
                          background: paginaAtiva === m.key ? '#1e2235' : 'transparent',
                          transition: 'transform 0.15s ease',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateX(2px)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateX(0)' }}
                      >
                        {m.icone}  {m.titulo}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator style={{ background: '#2d3148' }} />
          </>
        )}

      </SidebarContent>

      <SidebarFooter style={{ background: '#13161f' }}>
        <SidebarSeparator style={{ background: '#2d3148' }} />
        <p className="text-center text-xs py-2" style={{ color: '#2d3148' }}>
          v1.0 · {new Date().toLocaleDateString('pt-BR')}
        </p>
      </SidebarFooter>

    </Sidebar>
  )
}