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

        {/* Home + Assistente */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Home */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={paginaAtiva === 'home'}
                  onClick={() => onNavegar('home')}
                  className="font-semibold cursor-pointer"
                  style={{
                    color: paginaAtiva === 'home' ? '#e2e8f0' : '#8892a4',
                    background: paginaAtiva === 'home' ? '#1e2235' : 'transparent',
                  }}
                >
                  🏠  Home
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Assistente IA — placeholder */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={paginaAtiva === 'assistente'}
                  onClick={() => onNavegar('assistente')}
                  className="font-semibold cursor-pointer"
                  style={{
                    color: paginaAtiva === 'assistente' ? '#e2e8f0' : '#8892a4',
                    background: paginaAtiva === 'assistente' ? '#1e2235' : 'transparent',
                    opacity: 0.5,
                    cursor: 'not-allowed',
                  }}
                  title="Em desenvolvimento"
                >
                  🤖  Assistente
                  <span
                    className="ml-auto text-xs rounded px-1.5 py-0.5"
                    style={{ background: '#1e2235', color: '#4f8ef7', fontSize: '10px' }}
                  >
                    em breve
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Dashboard */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={paginaAtiva === 'dashboard'}
                  onClick={() => onNavegar('dashboard')}
                  className="font-semibold cursor-pointer"
                  style={{
                    color: paginaAtiva === 'dashboard' ? '#e2e8f0' : '#8892a4',
                    background: paginaAtiva === 'dashboard' ? '#1e2235' : 'transparent',
                  }}
                >
                  📈  Dashboard
                </SidebarMenuButton>
              </SidebarMenuItem>
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

        <SidebarSeparator style={{ background: '#2d3148' }} />

        {/* Admin */}
        <SidebarGroup>
          <SidebarGroupLabel style={{ color: '#8892a4', fontWeight: 700 }}>
            ⚙️ Administração
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={paginaAtiva === 'usuarios'}
                  onClick={() => onNavegar('usuarios')}
                  className="cursor-pointer text-sm"
                  style={{
                    color: paginaAtiva === 'usuarios' ? '#e2e8f0' : '#8892a4',
                    background: paginaAtiva === 'usuarios' ? '#1e2235' : 'transparent',
                  }}
                >
                  👥  Usuários
                </SidebarMenuButton>
              </SidebarMenuItem>
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