import { useState, useEffect } from 'react'
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
import { CapOperacional } from '@/pages/CapOperacional'
import { Estoque } from '@/pages/Estoque'
import { FatDistribuicao } from '@/pages/FatDistribuicao'
import { FatArmazenagem } from '@/pages/FatArmazenagem'
import { DashboardPage } from '@/pages/DashboardPage'
import { Hub } from '@/pages/Hub'
import { Perfil } from '@/pages/Perfil'
import { ToastContainer, ToastData } from '@/components/Toast'
import { Atlas } from '@/pages/Atlas'
import { useOutlookNotifier } from '@/hooks/useOutlookNotifier'
import { LogoBaia360 } from '@/components/LogoBaia360'
import { BaseConhecimento } from '@/pages/BaseConhecimento'
import { Agenda } from '@/pages/Agenda'

import { API } from '@/config'

interface Usuario {
  id: number
  nome: string
  email: string
  perfil: string
}


function Cadastro({ onVoltar, onCadastro }: { onVoltar: () => void; onCadastro: (u: any) => void }) {
  const [nome, setNome]                   = useState('')
  const [email, setEmail]                 = useState('')
  const [senha, setSenha]                 = useState('')
  const [senhaConf, setSenhaConf]         = useState('')
  const [erro, setErro]                   = useState('')
  const [loading, setLoading]             = useState(false)

  const forcaSenha = senha.length === 0 ? 0 : senha.length < 6 ? 1 : senha.length < 8 ? 2 : senha.length < 12 ? 3 : 4
  const coresForca = ['#2d3148', '#ef4444', '#f59e0b', '#4f8ef7', '#1D9E75']
  const labelsForca = ['', 'Fraca', 'Razoável', 'Boa', 'Forte']

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    if (senha !== senhaConf) { setErro('As senhas não coincidem'); return }
    if (senha.length < 8)    { setErro('A senha deve ter pelo menos 8 caracteres'); return }
    setLoading(true)
    try {
      await axios.post(`${API}/api/auth/cadastro`, {
        nome, email, senha, senha_confirmacao: senhaConf
      })
      setErro('')
      alert('Cadastro realizado! Aguarde a aprovação do administrador.')
      onVoltar()
    } catch (err: any) {
      setErro(err.response?.data?.erro || 'Erro ao criar conta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0f1117' }}>
      <Card className="w-full max-w-md border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader className="text-center space-y-1">
          <div className="flex justify-center mb-3">
            <LogoBaia360 size={72} />
          </div>
          <CardTitle className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Criar conta</CardTitle>
          <CardDescription style={{ color: '#8892a4' }}>Baia 4 Logística e Transportes</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome" style={{ color: '#8892a4' }}>Nome completo</Label>
              <Input
                id="nome"
                type="text"
                placeholder="Seu nome completo"
                value={nome}
                onChange={e => setNome(e.target.value)}
                required
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-cad" style={{ color: '#8892a4' }}>E-mail</Label>
              <Input
                id="email-cad"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha-cad" style={{ color: '#8892a4' }}>Senha</Label>
              <Input
                id="senha-cad"
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                required
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
              {senha.length > 0 && (
                <div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {[1,2,3,4].map(i => (
                      <div key={i} style={{ flex: 1, height: 3, borderRadius: 99, background: i <= forcaSenha ? coresForca[forcaSenha] : '#2d3148', transition: 'background .2s' }} />
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: coresForca[forcaSenha], marginTop: 4 }}>{labelsForca[forcaSenha]}</p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha-conf" style={{ color: '#8892a4' }}>Confirmar senha</Label>
              <Input
                id="senha-conf"
                type="password"
                placeholder="Repita a senha"
                value={senhaConf}
                onChange={e => setSenhaConf(e.target.value)}
                required
                style={{
                  background: '#0f1117',
                  borderColor: senhaConf.length > 0 ? (senhaConf === senha ? '#1D9E75' : '#ef4444') : '#2d3148',
                  color: '#e2e8f0'
                }}
              />
              {senhaConf.length > 0 && senhaConf !== senha && (
                <p style={{ fontSize: 12, color: '#ef4444' }}>As senhas não coincidem</p>
              )}
            </div>
            {erro && <p className="text-sm text-center" style={{ color: '#ef4444' }}>{erro}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              style={{ background: '#4f8ef7', color: 'white' }}
            >
              {loading ? 'Criando conta...' : 'Criar conta'}
            </Button>
          </form>
          <div className="text-center mt-4" style={{ fontSize: 13, color: '#8892a4' }}>
            Já tem conta?{' '}
            <button onClick={onVoltar} style={{ color: '#4f8ef7', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
              Entrar
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Login({ onLogin, onCadastro }: { onLogin: (u: Usuario) => void; onCadastro: () => void }) {
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
          <div className="flex justify-center mb-3">
          <LogoBaia360 size={72} />
          </div>
          <CardTitle className="text-3xl font-bold" style={{ color: '#e2e8f0' }}>
          Baia 360
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
          <div className="text-center mt-4" style={{ fontSize: 13, color: '#8892a4' }}>
            Não tem conta?{' '}
            <button onClick={onCadastro} style={{ color: '#4f8ef7', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
              Criar conta
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Dashboard({ usuario, onLogout, onVoltarHub, onAtualizarUsuario, paginaInicial = 'home' }: { usuario: Usuario, onLogout: () => void, onVoltarHub: () => void, onAtualizarUsuario: (u: Usuario) => void, paginaInicial?: string }) {
  const [paginaAtiva, setPaginaAtiva] = useState(paginaInicial)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const adicionarToast = (tipo: 'sucesso' | 'erro' | 'aviso', mensagem: string) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, tipo, mensagem }])
  }
  const removerToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  useEffect(() => {
    (window as any)._toast = adicionarToast
    return () => { delete (window as any)._toast }
  }, [])

  const perfil = usuario.perfil
  const isAdmin      = perfil === 'admin'
  const isAnalista   = perfil === 'analista'
  const isFinanceiro = perfil === 'financeiro'

  const renderPagina = () => {
    switch (paginaAtiva) {
      case 'home':
        return <Home onNavegar={setPaginaAtiva} />
      case 'usuarios':
        return isAdmin ? <Usuarios /> : null
      case 'fretes':
        return (isAdmin || isAnalista) ? <Fretes /> : null
      case 'armazenagem':
        return (isAdmin || isAnalista) ? <Armazenagem /> : null
      case 'pedidos':
        return (isAdmin || isAnalista) ? <Pedidos /> : null
      case 'recebimentos':
        return (isAdmin || isAnalista) ? <Recebimentos /> : null
      case 'cap_operacional':
        return (isAdmin || isAnalista) ? <CapOperacional /> : null
      case 'estoque':
        return (isAdmin || isAnalista) ? <Estoque /> : null
      case 'fat_dist':
        return (isAdmin || isFinanceiro) ? <FatDistribuicao /> : null
      case 'fat_arm':
        return (isAdmin || isFinanceiro) ? <FatArmazenagem /> : null
      case 'dashboard':
        return isAdmin ? <DashboardPage /> : null
      case 'perfil':
        return <Perfil usuario={usuario} onAtualizar={onAtualizarUsuario} />
      case 'agenda':
        return <Agenda />
      case 'base_conhecimento':
        return isAdmin ? <BaseConhecimento /> : null
      default:
        return (
          <div className="p-8">
            <h2 className="text-xl font-bold mb-2" style={{ color: '#e2e8f0' }}>Em construção</h2>
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
          <ToastContainer toasts={toasts} onRemover={removerToast} />

          <AppSidebar paginaAtiva={paginaAtiva} onNavegar={setPaginaAtiva} perfil={usuario.perfil} />

          <div className="flex flex-col flex-1 min-w-0">
            {/* Topbar */}
            <header
              className="flex items-center justify-between px-6 py-3 border-b"
              style={{ background: '#13161f', borderColor: '#2d3148' }}
            >
              <div className="flex items-center gap-3">
                <SidebarTrigger style={{ color: '#8892a4' }} />
                <button
                  onClick={onVoltarHub}
                  className="text-xs px-3 py-1.5 rounded-md font-medium"
                  style={{ color: '#4f8ef7', background: '#4f8ef711', border: '1px solid #4f8ef733', cursor: 'pointer' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = '#4f8ef722'
                    ;(e.currentTarget as HTMLElement).style.borderColor = '#4f8ef7'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = '#4f8ef711'
                    ;(e.currentTarget as HTMLElement).style.borderColor = '#4f8ef733'
                  }}
                >
                  ← Baia 360
                </button>
                <span style={{ color: '#2d3148' }}>|</span>
                <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
                  Central de Relatórios
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPaginaAtiva('perfil')}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4f8ef722', border: '1px solid #4f8ef744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4f8ef7' }}>
                    {(usuario.nome.trim().split(' ').length === 1
                      ? usuario.nome.slice(0, 2)
                      : usuario.nome.trim().split(' ')[0][0] + usuario.nome.trim().split(' ').slice(-1)[0][0]
                    ).toUpperCase()}
                  </div>
                  <span style={{ fontSize: 13, color: '#8892a4' }}>{usuario.nome.split(' ')[0]}</span>
                </button>
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
              <div key={paginaAtiva} className="page-fade">
                {renderPagina()}
              </div>
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
  const [tela, setTela] = useState<'hub' | 'relatorios' | 'atlas' | 'dashboard' | 'agenda' | 'usuarios' | 'base_conhecimento'>('hub')
  const [telaNaoLogado, setTelaNaoLogado] = useState<'login' | 'cadastro'>('login')

  // ── Toasts globais (visíveis em qualquer tela) ──────────────────────────────
  const [toastsGlobais, setToastsGlobais] = useState<ToastData[]>([])
  const adicionarToastGlobal = (tipo: ToastData['tipo'], mensagem: string) => {
    const id = Date.now()
    setToastsGlobais(prev => [...prev, { id, tipo, mensagem }])
  }
  const removerToastGlobal = (id: number) => {
    setToastsGlobais(prev => prev.filter(t => t.id !== id))
  }

  // ── Notificador de eventos do Outlook ───────────────────────────────────────
  useOutlookNotifier({
    token:    localStorage.getItem('token'),
    onAviso:  (msg) => adicionarToastGlobal('aviso', msg),
    horasAhead: 2
  })

  // Desloga automaticamente ao fechar o app
  useEffect(() => {
    const handleClose = () => {
      localStorage.removeItem('token')
      localStorage.removeItem('usuario')
    }
    window.addEventListener('beforeunload', handleClose)
    return () => window.removeEventListener('beforeunload', handleClose)
  }, [])

  const handleLogin  = (u: Usuario) => { setUsuario(u); setTela('hub'); setTelaNaoLogado('login') }
const handleLogout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('usuario')
  setUsuario(null)
  setTela('hub')
  }

  if (!usuario) {
    if (telaNaoLogado === 'cadastro') return (
      <Cadastro
        onVoltar={() => setTelaNaoLogado('login')}
        onCadastro={(u) => handleLogin(u)}
      />
    )
    return <Login onLogin={handleLogin} onCadastro={() => setTelaNaoLogado('cadastro')} />
  }
  if (tela === 'hub') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <Hub
      usuario={usuario}
      onEntrarRelatorios={() => setTela('relatorios')}
      onEntrarAtlas={() => setTela('atlas')}
      onEntrarDashboard={() => setTela('dashboard')}
      onEntrarAgenda={() => setTela('agenda')}
      onEntrarUsuarios={() => setTela('usuarios')}
      onEntrarBaseConhecimento={() => setTela('base_conhecimento')}
      onLogout={handleLogout}
    />
    </>
  )
if (tela === 'dashboard') return (
    <Dashboard
      usuario={usuario}
      onLogout={handleLogout}
      onVoltarHub={() => setTela('hub')}
      onAtualizarUsuario={u => setUsuario(u)}
      paginaInicial="dashboard"
    />
  )

  if (tela === 'agenda') return (
    <Dashboard
      usuario={usuario}
      onLogout={handleLogout}
      onVoltarHub={() => setTela('hub')}
      onAtualizarUsuario={u => setUsuario(u)}
      paginaInicial="agenda"
    />
  )

  if (tela === 'usuarios') return (
    <Dashboard
      usuario={usuario}
      onLogout={handleLogout}
      onVoltarHub={() => setTela('hub')}
      onAtualizarUsuario={u => setUsuario(u)}
      paginaInicial="usuarios"
    />
  )

  if (tela === 'base_conhecimento') return (
    <Dashboard
      usuario={usuario}
      onLogout={handleLogout}
      onVoltarHub={() => setTela('hub')}
      onAtualizarUsuario={u => setUsuario(u)}
      paginaInicial="base_conhecimento"
    />
  )

  if (tela === 'atlas') return (
  <>
  <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1117' }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 48, borderBottom: '1px solid #2d3148', background: '#13161f', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => setTela('hub')} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, color: '#7c3aed', background: '#7c3aed11', border: '1px solid #7c3aed33', cursor: 'pointer' }}>
          ← Baia 360
        </button>
        <span style={{ color: '#2d3148' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>🤖 Atlas</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4f8ef722', border: '1px solid #4f8ef744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4f8ef7' }}>
          {(usuario.nome.trim().split(' ').length === 1
            ? usuario.nome.slice(0, 2)
            : usuario.nome.trim().split(' ')[0][0] + usuario.nome.trim().split(' ').slice(-1)[0][0]
          ).toUpperCase()}
        </div>
        <span style={{ fontSize: 13, color: '#8892a4' }}>{usuario.nome.split(' ')[0]}</span>
      </div>
    </header>
    <Atlas nomeUsuario={usuario.nome} />
  </div>
  </>
)
return (
  <Dashboard
    usuario={usuario}
    onLogout={handleLogout}
    onVoltarHub={() => setTela('hub')}
    onAtualizarUsuario={u => setUsuario(u)}
  />
)
}