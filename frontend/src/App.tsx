import { useState } from 'react'
import axios from 'axios'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/AppSidebar'
import { Home } from '@/pages/Home'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Usuarios } from '@/pages/Usuarios'
import { Fretes } from '@/pages/Fretes'
import { Armazenagem } from '@/pages/Armazenagem'
import { Pedidos } from '@/pages/Pedidos'
import { Recebimentos } from '@/pages/Recebimentos'

const API = 'http://localhost:5000'

interface Usuario {
  id: number
  nome: string
  email: string
  perfil: string
}

function Login({ onLogin }: { onLogin: (u: Usuario) => void }) {
  const [email, setEmail]     = useState('')
  const [senha, setSenha]     = useState('')
  const [erro, setErro]       = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      const res = await axios.post(`${API}/api/auth/login`, { email, senha })
      localStorage.setItem('token',   res.data.token)
      localStorage.setItem('usuario', JSON.stringify(res.data.usuario))
      onLogin(res.data.usuario)
    } catch (err: any) {
      setErro(err.response?.data?.erro || 'Erro ao conectar ao servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#0f1117' }}
    >
      <Card className="w-full max-w-md border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader className="text-center space-y-1">
          <div className="text-5xl mb-2">📊</div>
          <CardTitle className="text-3xl font-bold" style={{ color: '#4f8ef7' }}>
            Central de Relatórios
          </CardTitle>
          <CardDescription style={{ color: '#8892a4' }}>
            Baia 4 Logística e Transportes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" style={{ color: '#8892a4' }}>Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{
                  background: '#0f1117',
                  borderColor: '#2d3148',
                  color: '#e2e8f0',
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha" style={{ color: '#8892a4' }}>Senha</Label>
              <Input
                id="senha"
                type="password"
                placeholder="••••••••"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                required
                style={{
                  background: '#0f1117',
                  borderColor: '#2d3148',
                  color: '#e2e8f0',
                }}
              />
            </div>
            {erro && (
              <p className="text-sm text-center" style={{ color: '#ef4444' }}>{erro}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              style={{ background: '#4f8ef7', color: 'white' }}
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function Dashboard({ usuario, onLogout }: { usuario: Usuario, onLogout: () => void }) {
  const [paginaAtiva, setPaginaAtiva] = useState('home')

  const renderPagina = () => {
    switch (paginaAtiva) {
      case 'home':
        return <Home onNavegar={setPaginaAtiva} />
        case 'usuarios':
        return <Usuarios />
        case 'fretes':
        return <Fretes />
        case 'armazenagem':
        return <Armazenagem />
        case 'pedidos':
        return <Pedidos />
        case 'recebimentos':
        return <Recebimentos />
      default:
        return (
          <div className="p-8">
            <h2 className="text-xl font-bold mb-2" style={{ color: '#e2e8f0' }}>
              Em construção
            </h2>
            <p style={{ color: '#8892a4' }}>
              O módulo <strong style={{ color: '#4f8ef7' }}>{paginaAtiva}</strong> será implementado em breve.
            </p>
          </div>
        )
    }
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full" style={{ background: '#0f1117' }}>

          <AppSidebar paginaAtiva={paginaAtiva} onNavegar={setPaginaAtiva} />

          <div className="flex flex-col flex-1 min-w-0">
            {/* Topbar */}
            <header
              className="flex items-center justify-between px-6 py-3 border-b"
              style={{ background: '#13161f', borderColor: '#2d3148' }}
            >
              <div className="flex items-center gap-3">
                <SidebarTrigger style={{ color: '#8892a4' }} />
                <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
                  Central de Relatórios
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: '#8892a4' }}>
                  {usuario.nome}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLogout}
                  className="border text-xs"
                  style={{ borderColor: '#2d3148', color: '#8892a4', background: 'transparent' }}
                >
                  Sair
                </Button>
              </div>
            </header>

            {/* Conteúdo */}
            <main className="flex-1 overflow-auto">
              {renderPagina()}
            </main>
          </div>

        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(() => {
    const u = localStorage.getItem('usuario')
    return u ? JSON.parse(u) : null
  })

  const handleLogin  = (u: Usuario) => setUsuario(u)
  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('usuario')
    setUsuario(null)
  }

  return usuario
    ? <Dashboard usuario={usuario} onLogout={handleLogout} />
    : <Login onLogin={handleLogin} />
}