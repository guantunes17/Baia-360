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
import { PainelControle } from '@/pages/PainelControle'
import { PainelResultados } from '@/pages/PainelResultados'
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
  const [cadastrado, setCadastrado]       = useState(false)
  const [nomeRegistrado, setNomeRegistrado] = useState('')

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
      setNomeRegistrado(nome.split(' ')[0])
      setCadastrado(true)
    } catch (err: any) {
      setErro(err.response?.data?.erro || 'Erro ao criar conta')
    } finally {
      setLoading(false)
    }
  }

if (cadastrado) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0f1117' }}>
      <Card className="w-full max-w-md border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardContent className="pt-8 pb-8">
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f59e0b22', border: '2px solid #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>
              ⏳
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
              Quase lá, {nomeRegistrado}!
            </h2>
            <p style={{ fontSize: 13, color: '#8892a4', marginBottom: 20, lineHeight: 1.6 }}>
              Seu cadastro foi realizado com sucesso.<br />
              Um administrador precisa aprovar seu acesso antes que você possa entrar.
            </p>
            <div style={{ background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: 8, padding: '12px 16px', marginBottom: 24, textAlign: 'left' }}>
              <p style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 4 }}>O que acontece agora?</p>
              <p style={{ fontSize: 12, color: '#8892a4', lineHeight: 1.6 }}>
                O time de administração será notificado e aprovará seu acesso em breve. Você receberá acesso completo assim que for aprovado.
              </p>
            </div>
            <button
              onClick={onVoltar}
              style={{ background: '#4f8ef7', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}
            >
              Voltar para o login
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )

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
              {/* Card fixo de requisitos */}
              <div style={{ background: '#0f1117', border: '1px solid #2d3148', borderRadius: 8, padding: '10px 12px', marginTop: 6 }}>
                <p style={{ fontSize: 11, color: '#8892a4', marginBottom: 6, fontWeight: 600 }}>A senha deve conter:</p>
                {[
                  { ok: senha.length >= 8,           label: 'Mínimo 8 caracteres' },
                  { ok: /[A-Z]/.test(senha),          label: '1 letra maiúscula (A-Z)' },
                  { ok: /[^a-zA-Z0-9]/.test(senha),  label: '1 caractere especial (!@#$%...)' },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: r.ok ? '#1D9E75' : '#8892a4' }}>{r.ok ? '✓' : '○'}</span>
                    <span style={{ fontSize: 11, color: r.ok ? '#1D9E75' : '#8892a4' }}>{r.label}</span>
                  </div>
                ))}
                {senha.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      {[1,2,3,4].map(i => (
                        <div key={i} style={{ flex: 1, height: 3, borderRadius: 99, background: i <= forcaSenha ? coresForca[forcaSenha] : '#2d3148', transition: 'background .2s' }} />
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: coresForca[forcaSenha], marginTop: 4 }}>{labelsForca[forcaSenha]}</p>
                  </div>
                )}
              </div>
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
              erro.toLowerCase().includes('aprovação') || erro.toLowerCase().includes('pendente') ? (
                <div style={{ background: '#f59e0b11', border: '1px solid #f59e0b44', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 2 }}>⏳ Cadastro em análise</p>
                  <p style={{ fontSize: 12, color: '#8892a4' }}>Seu acesso ainda não foi aprovado pelo administrador.</p>
                </div>
              ) : (
                <p className="text-sm text-center" style={{ color: '#ef4444' }}>{erro}</p>
              )
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

function Dashboard({ usuario, onLogout, onVoltarHub, onAtualizarUsuario, paginaInicial = 'home', permissoes }: { usuario: Usuario, onLogout: () => void, onVoltarHub: () => void, onAtualizarUsuario: (u: Usuario) => void, paginaInicial?: string, permissoes: { hub: string[]; modulos: string[] } | null }) {
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

  const isAdmin   = perfil === 'admin'
  const temModulo = (mod: string) => isAdmin || (permissoes?.modulos.includes(mod) ?? false)

  const renderPagina = () => {
    switch (paginaAtiva) {
      case 'home':
        return <Home onNavegar={setPaginaAtiva} modulosPermitidos={isAdmin ? undefined : permissoes?.modulos} />
      case 'usuarios':
        return isAdmin ? <Usuarios /> : null
      case 'fretes':
        return temModulo('Fretes') ? <Fretes /> : null
      case 'armazenagem':
        return temModulo('Armazenagem') ? <Armazenagem /> : null
      case 'pedidos':
        return temModulo('Pedidos') ? <Pedidos /> : null
      case 'recebimentos':
        return temModulo('Recebimentos') ? <Recebimentos /> : null
      case 'cap_operacional':
        return temModulo('Cap. Operacional') ? <CapOperacional /> : null
      case 'estoque':
        return temModulo('Estoque') ? <Estoque /> : null
      case 'fat_dist':
        return temModulo('Fat. Distribuição') ? <FatDistribuicao /> : null
      case 'fat_arm':
        return temModulo('Fat. Armazenagem') ? <FatArmazenagem /> : null
      case 'painel_controle':
        return isAdmin ? <PainelControle /> : null
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

          <AppSidebar paginaAtiva={paginaAtiva} onNavegar={setPaginaAtiva} perfil={usuario.perfil} modulosPermitidos={permissoes?.modulos} />

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

function PaginaSimples({ titulo, icone, usuario, onVoltar, onPerfil, children }: {
  titulo: string
  icone: string
  usuario: Usuario
  onVoltar: () => void
  onPerfil: () => void
  children: React.ReactNode
}) {
  const iniciais = (usuario.nome.trim().split(' ').length === 1
    ? usuario.nome.slice(0, 2)
    : usuario.nome.trim().split(' ')[0][0] + usuario.nome.trim().split(' ').slice(-1)[0][0]
  ).toUpperCase()

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1117' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 48, borderBottom: '1px solid #2d3148', background: '#13161f', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onVoltar} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, color: '#4f8ef7', background: '#4f8ef711', border: '1px solid #4f8ef733', cursor: 'pointer' }}>
            ← Baia 360
          </button>
          <span style={{ color: '#2d3148' }}>|</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{icone} {titulo}</span>
        </div>
        <button
          onClick={onPerfil}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#1a1d27'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
        >
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4f8ef722', border: '1px solid #4f8ef744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4f8ef7' }}>
            {iniciais}
          </div>
          <span style={{ fontSize: 13, color: '#8892a4' }}>{usuario.nome.split(' ')[0]}</span>
        </button>
      </header>
      <main style={{ flex: 1, overflowY: 'auto' }}>{children}</main>
    </div>
  )
}

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(() => {
    const u = localStorage.getItem('usuario')
    return u ? JSON.parse(u) : null
  })
  const [tela, setTela] = useState<'hub' | 'relatorios' | 'atlas' | 'painel_controle' | 'painel_resultados' | 'agenda' | 'usuarios' | 'base_conhecimento'>('hub')
  const [telaNaoLogado, setTelaNaoLogado] = useState<'login' | 'cadastro'>('login')
  const [pendentes, setPendentes] = useState(0)
  const [paginaInicialRelatorios, setPaginaInicialRelatorios] = useState('home')

  const [permissoes, setPermissoes] = useState<{ hub: string[]; modulos: string[] } | null>(null)

  // Carrega permissões ao logar
  useEffect(() => {
    if (!usuario) { setPermissoes(null); return }
    const token = localStorage.getItem('token')
    if (!token) return
    fetch(`${API}/api/auth/me/permissoes`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => setPermissoes(data))
      .catch(() => {})
  }, [usuario])

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

  // Polling de usuários pendentes — apenas admin, apenas na tela hub
  useEffect(() => {
    if (usuario?.perfil !== 'admin') return
    const buscar = () => {
      const token = localStorage.getItem('token')
      if (!token) return
      fetch(`${API}/api/auth/usuarios`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            setPendentes(data.filter((u: any) => u.status === 'pendente').length)
          }
        })
        .catch(() => {})
    }
    buscar()
    const intervalo = setInterval(buscar, 60000) // a cada 60 segundos
    return () => clearInterval(intervalo)
  }, [usuario])

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
      onEntrarPainelControle={() => setTela('painel_controle')}
      onEntrarPainelResultados={() => setTela('painel_resultados')}
      onEntrarAgenda={() => setTela('agenda')}
      onEntrarUsuarios={() => { setTela('usuarios'); setPendentes(0) }}
      onEntrarBaseConhecimento={() => setTela('base_conhecimento')}
      onEntrarPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}
      pendentes={pendentes}
      permissoes={permissoes}
      onLogout={handleLogout}
    />
    </>
  )
if (tela === 'painel_controle') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <PaginaSimples titulo="Painel de Controle" icone="📡" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
        <PainelControle />
      </PaginaSimples>
    </>
  )

  if (tela === 'painel_resultados') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <PaginaSimples titulo="Painel de Resultados" icone="📈" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
        <PainelResultados />
      </PaginaSimples>
    </>
  )

  if (tela === 'agenda') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <PaginaSimples titulo="Agenda" icone="📅" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
        <Agenda />
      </PaginaSimples>
    </>
  )

  if (tela === 'usuarios') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <PaginaSimples titulo="Usuários" icone="👥" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
        <Usuarios />
      </PaginaSimples>
    </>
  )

  if (tela === 'base_conhecimento') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <PaginaSimples titulo="Base de Conhecimento" icone="🧠" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
        <BaseConhecimento />
      </PaginaSimples>
    </>
  )

  if (tela === 'atlas') return (
  <>
  <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1117' }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 48, borderBottom: '1px solid #2d3148', background: '#13161f', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => { const evt = new CustomEvent('atlas-toggle-sidebar'); window.dispatchEvent(evt) }} style={{ width: 32, height: 32, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#8892a4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
        <button onClick={() => setTela('hub')} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, color: '#7c3aed', background: '#7c3aed11', border: '1px solid #7c3aed33', cursor: 'pointer' }}>
          ← Baia 360
        </button>
        <span style={{ color: '#2d3148' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>🤖 Atlas</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}
          title="Meu perfil"
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 8, transition: 'background .12s' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#1a1d27'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
        >
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4f8ef722', border: '1px solid #4f8ef744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4f8ef7' }}>
            {(usuario.nome.trim().split(' ').length === 1
              ? usuario.nome.slice(0, 2)
              : usuario.nome.trim().split(' ')[0][0] + usuario.nome.trim().split(' ').slice(-1)[0][0]
            ).toUpperCase()}
          </div>
          <span style={{ fontSize: 13, color: '#8892a4' }}>{usuario.nome.split(' ')[0]}</span>
        </button>
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
    onVoltarHub={() => { setPaginaInicialRelatorios('home'); setTela('hub') }}
    onAtualizarUsuario={u => setUsuario(u)}
    paginaInicial={paginaInicialRelatorios}
    permissoes={permissoes}
  />
)
}