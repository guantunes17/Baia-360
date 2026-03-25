import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { MODULOS } from '@/lib/constants'

interface Props {
  paginaAtiva: string
  onNavegar: (key: string) => void
}

const modulos_operacional = MODULOS.filter(m => m.grupo === 'operacional')
const modulos_financeiro  = MODULOS.filter(m => m.grupo === 'financeiro')

export function AppSidebar({ paginaAtiva, onNavegar }: Props) {
  return (
    <Sidebar className="border-r border-[#2d3148]" style={{ background: '#13161f' }}>

      {/* Header */}
      <SidebarHeader className="px-4 py-5" style={{ background: '#13161f' }}>
        <div className="flex flex-col items-center gap-1">
          <div className="w-full h-1 rounded mb-3" style={{ background: '#4f8ef7' }} />
          <span className="text-3xl">📊</span>
          <span className="text-sm font-bold text-center leading-tight" style={{ color: '#e2e8f0' }}>
            Central de<br />Relatórios
          </span>
        </div>
      </SidebarHeader>

      <SidebarSeparator style={{ background: '#2d3148' }} />

      <SidebarContent style={{ background: '#13161f' }}>

        {/* Home e Dashboard */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {[
                { key: 'home',      label: '🏠  Home' },
                { key: 'dashboard', label: '📈  Dashboard' },
              ].map(item => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={paginaAtiva === item.key}
                    onClick={() => onNavegar(item.key)}
                    className="font-semibold cursor-pointer"
                    style={{
                      color: paginaAtiva === item.key ? '#e2e8f0' : '#8892a4',
                      background: paginaAtiva === item.key ? '#1e2235' : 'transparent',
                    }}
                  >
                    {item.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator style={{ background: '#2d3148' }} />

        {/* Operacional */}
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
                    }}
                  >
                    {m.icone}  {m.titulo}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator style={{ background: '#2d3148' }} />

        {/* Financeiro */}
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
                    }}
                  >
                    {m.icone}  {m.titulo}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      {/* Footer */}
      <SidebarFooter style={{ background: '#13161f' }}>
        <SidebarSeparator style={{ background: '#2d3148' }} />
        <p className="text-center text-xs py-2" style={{ color: '#2d3148' }}>
          v1.0 · {new Date().toLocaleDateString('pt-BR')}
        </p>
      </SidebarFooter>

    </Sidebar>
  )
}