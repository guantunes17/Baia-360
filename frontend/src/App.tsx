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
import { T } from '@/lib/theme'
import { glass, neoShadow, neoShadowInset } from '@/lib/glass'
import { useRipple } from '@/hooks/useRipple'
import { addRipple } from '@/lib/ripple'
import { AmbientBackground } from '@/components/AmbientBackground'
import { Mail, Shield, Eye, EyeOff, User, Lock, Clock, Check, Circle, LogOut } from 'lucide-react'

interface Usuario {
  id: number
  nome: string
  email: string
  perfil: string
}


function Cadastro({ onVoltar, onCadastro }: { onVoltar: () => void; onCadastro: (u: any) => void }) {
  const [nome, setNome]                     = useState('')
  const [email, setEmail]                   = useState('')
  const [senha, setSenha]                   = useState('')
  const [senhaConf, setSenhaConf]           = useState('')
  const [erro, setErro]                     = useState('')
  const [loading, setLoading]               = useState(false)
  const [cadastrado, setCadastrado]         = useState(false)
  const [nomeRegistrado, setNomeRegistrado] = useState('')
  const btnRef = useRipple<HTMLButtonElement>()

  const forcaSenha = senha.length === 0 ? 0 : senha.length < 6 ? 1 : senha.length < 8 ? 2 : senha.length < 12 ? 3 : 4
  const coresForca = [T.textDim, T.accentRed, T.accentAmber, T.accentBlue, T.accentGreen]
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

  const cardStyle = {
    position: 'relative' as const,
    zIndex: 1,
    width: '100%',
    maxWidth: 440,
    ...glass(0.3, 24),
    borderRadius: 20,
    padding: '40px 32px',
    boxShadow: `0 20px 60px rgba(0,0,0,0.4), ${neoShadow}`,
  }

  const inputBase = {
    width: '100%',
    padding: '10px 12px 10px 36px',
    ...glass(0.25, 12),
    borderRadius: 10,
    color: T.text,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    boxShadow: neoShadowInset,
    transition: 'border-color .2s, box-shadow .2s',
  }

  const onFocusInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = T.borderGold
    e.currentTarget.style.boxShadow = `${neoShadowInset}, 0 0 20px rgba(240,180,41,0.06)`
  }
  const onBlurInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = T.border
    e.currentTarget.style.boxShadow = neoShadowInset
  }

  if (cadastrado) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ position: 'relative' }}>
      <AmbientBackground variant="login" />
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: `${T.accentAmber}22`, border: `2px solid ${T.accentAmber}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Clock size={28} color={T.accentAmber} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>
            Quase lá, {nomeRegistrado}!
          </h2>
          <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 20, lineHeight: 1.6 }}>
            Seu cadastro foi realizado com sucesso.<br />
            Um administrador precisa aprovar seu acesso antes que você possa entrar.
          </p>
          <div style={{ ...glass(0.2, 10), borderRadius: 8, padding: '12px 16px', marginBottom: 24, textAlign: 'left', borderColor: `${T.accentAmber}44` }}>
            <p style={{ fontSize: 12, color: T.accentAmber, fontWeight: 600, marginBottom: 4 }}>O que acontece agora?</p>
            <p style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>
              O time de administração será notificado e aprovará seu acesso em breve. Você receberá acesso completo assim que for aprovado.
            </p>
          </div>
          <button
            onClick={onVoltar}
            style={{ background: `linear-gradient(135deg, ${T.gold}, #d49b1f)`, color: T.navyDeep, border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%', boxShadow: '0 2px 12px rgba(240,180,41,0.15)' }}
          >
            Voltar para o login
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ position: 'relative' }}>
      <AmbientBackground variant="login" />
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <div style={{ background: 'rgba(240,180,41,0.05)', borderRadius: 20, padding: 12 }}>
            <LogoBaia360 size={64} />
          </div>
        </div>
        <h2 style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, color: T.text, marginBottom: 4 }}>Criar conta</h2>
        <p style={{ textAlign: 'center', fontSize: 13, color: T.textMuted, marginBottom: 24 }}>Baia 4 Logística e Transportes</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Nome */}
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Nome completo</label>
            <div style={{ position: 'relative' }}>
              <User size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textDim, pointerEvents: 'none' }} />
              <input type="text" placeholder="Seu nome completo" value={nome} onChange={e => setNome(e.target.value)} required style={inputBase} onFocus={onFocusInput} onBlur={onBlurInput} />
            </div>
          </div>

          {/* Email */}
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>E-mail</label>
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textDim, pointerEvents: 'none' }} />
              <input type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required style={inputBase} onFocus={onFocusInput} onBlur={onBlurInput} />
            </div>
          </div>

          {/* Senha */}
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Senha</label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textDim, pointerEvents: 'none' }} />
              <input type="password" placeholder="Mínimo 8 caracteres" value={senha} onChange={e => setSenha(e.target.value)} required style={inputBase} onFocus={onFocusInput} onBlur={onBlurInput} />
            </div>
            <div style={{ ...glass(0.2, 10), borderRadius: 8, padding: '10px 12px', marginTop: 6 }}>
              <p style={{ fontSize: 11, color: T.textMuted, marginBottom: 6, fontWeight: 600 }}>A senha deve conter:</p>
              {[
                { ok: senha.length >= 8,          label: 'Mínimo 8 caracteres' },
                { ok: /[A-Z]/.test(senha),         label: '1 letra maiúscula (A-Z)' },
                { ok: /[^a-zA-Z0-9]/.test(senha), label: '1 caractere especial (!@#$%...)' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  {r.ok ? <Check size={12} color={T.accentGreen} /> : <Circle size={12} color={T.textMuted} />}
                  <span style={{ fontSize: 11, color: r.ok ? T.accentGreen : T.textMuted }}>{r.label}</span>
                </div>
              ))}
              {senha.length > 0 && (
                <div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                    {[1,2,3,4].map(i => (
                      <div key={i} style={{ flex: 1, height: 3, borderRadius: 99, background: i <= forcaSenha ? coresForca[forcaSenha] : T.textDim, boxShadow: i <= forcaSenha ? `0 0 6px ${coresForca[forcaSenha]}33` : 'none', transition: 'background .2s, box-shadow .2s' }} />
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: coresForca[forcaSenha], marginTop: 4 }}>{labelsForca[forcaSenha]}</p>
                </div>
              )}
            </div>
          </div>

          {/* Confirmar senha */}
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Confirmar senha</label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textDim, pointerEvents: 'none' }} />
              <input
                type="password"
                placeholder="Repita a senha"
                value={senhaConf}
                onChange={e => setSenhaConf(e.target.value)}
                required
                style={{ ...inputBase, borderColor: senhaConf.length > 0 ? (senhaConf === senha ? T.accentGreen : T.accentRed) : undefined }}
              />
            </div>
            {senhaConf.length > 0 && senhaConf !== senha && (
              <p style={{ fontSize: 12, color: T.accentRed, marginTop: 4 }}>As senhas não coincidem</p>
            )}
          </div>

          {erro && <p style={{ fontSize: 12, color: T.accentRed, textAlign: 'center' }}>{erro}</p>}

          <button
            ref={btnRef}
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: `linear-gradient(135deg, ${T.gold}, #d49b1f)`,
              color: T.navyDeep,
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 12px rgba(240,180,41,0.15)',
              transition: 'transform .15s, box-shadow .15s',
              opacity: loading ? 0.7 : 1,
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(240,180,41,0.3)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(240,180,41,0.15)' }}
          >
            {loading ? 'Criando conta...' : 'Criar conta'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: T.textMuted }}>
          Já tem conta?{' '}
          <button onClick={onVoltar} style={{ color: T.gold, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Entrar
          </button>
        </div>
      </div>
    </div>
  )
}

function Login({ onLogin, onCadastro }: { onLogin: (u: Usuario) => void; onCadastro: () => void }) {
  const [email, setEmail]               = useState('')
  const [senha, setSenha]               = useState('')
  const [erro, setErro]                 = useState('')
  const [loading, setLoading]           = useState(false)
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const btnRef = useRipple<HTMLButtonElement>()

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

  const inputBase = {
    width: '100%',
    padding: '10px 12px 10px 36px',
    ...glass(0.25, 12),
    borderRadius: 10,
    color: T.text,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    boxShadow: neoShadowInset,
    transition: 'border-color .2s, box-shadow .2s',
  }

  const onFocusInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = T.borderGold
    e.currentTarget.style.boxShadow = `${neoShadowInset}, 0 0 20px rgba(240,180,41,0.06)`
  }
  const onBlurInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = T.border
    e.currentTarget.style.boxShadow = neoShadowInset
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ position: 'relative' }}>
      <AmbientBackground variant="login" />
      <div style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: 440,
        ...glass(0.3, 24),
        borderRadius: 20,
        padding: '40px 32px',
        boxShadow: `0 20px 60px rgba(0,0,0,0.4), ${neoShadow}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{ background: 'rgba(240,180,41,0.05)', borderRadius: 20, padding: 12 }}>
            <LogoBaia360 size={72} />
          </div>
        </div>
        <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, color: T.text, marginBottom: 4 }}>Baia 360</h2>
        <p style={{ textAlign: 'center', fontSize: 13, color: T.textMuted, marginBottom: 28 }}>Baia 4 Logística e Transportes</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Email */}
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textDim, pointerEvents: 'none' }} />
              <input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={inputBase}
                onFocus={onFocusInput}
                onBlur={onBlurInput}
              />
            </div>
          </div>

          {/* Senha */}
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Senha</label>
            <div style={{ position: 'relative' }}>
              <Shield size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textDim, pointerEvents: 'none' }} />
              <input
                type={mostrarSenha ? 'text' : 'password'}
                placeholder="••••••••"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                required
                style={{ ...inputBase, paddingRight: 40 }}
                onFocus={onFocusInput}
                onBlur={onBlurInput}
              />
              <button
                type="button"
                onClick={() => setMostrarSenha(v => !v)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: T.textDim, display: 'flex', alignItems: 'center', padding: 0 }}
              >
                {mostrarSenha ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Erro */}
          {erro && (
            erro.toLowerCase().includes('aprovação') || erro.toLowerCase().includes('pendente') ? (
              <div style={{ ...glass(0.2, 10), borderRadius: 8, padding: '10px 14px', textAlign: 'center', borderColor: `${T.accentAmber}44` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 2 }}>
                  <Clock size={13} color={T.accentAmber} />
                  <p style={{ fontSize: 12, color: T.accentAmber, fontWeight: 600, margin: 0 }}>Cadastro em análise</p>
                </div>
                <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>Seu acesso ainda não foi aprovado pelo administrador.</p>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: T.accentRed, textAlign: 'center' }}>{erro}</p>
            )
          )}

          {/* Botão Entrar */}
          <button
            ref={btnRef}
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: `linear-gradient(135deg, ${T.gold}, #d49b1f)`,
              color: T.navyDeep,
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 12px rgba(240,180,41,0.15)',
              transition: 'transform .15s, box-shadow .15s',
              opacity: loading ? 0.7 : 1,
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(240,180,41,0.3)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(240,180,41,0.15)' }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: T.textMuted }}>
          Não tem conta?{' '}
          <button onClick={onCadastro} style={{ color: T.gold, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Criar conta
          </button>
        </div>
      </div>
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
        return temModulo('fretes') ? <Fretes /> : null
      case 'armazenagem':
        return temModulo('armazenagem') ? <Armazenagem /> : null
      case 'pedidos':
        return temModulo('pedidos') ? <Pedidos /> : null
      case 'recebimentos':
        return temModulo('recebimentos') ? <Recebimentos /> : null
      case 'cap_operacional':
        return temModulo('cap_operacional') ? <CapOperacional /> : null
      case 'estoque':
        return temModulo('estoque') ? <Estoque /> : null
      case 'fat_dist':
        return temModulo('fat_dist') ? <FatDistribuicao /> : null
      case 'fat_arm':
        return temModulo('fat_arm') ? <FatArmazenagem /> : null
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
            <h2 className="text-xl font-bold mb-2" style={{ color: T.text }}>Em construção</h2>
            <p style={{ color: T.textMuted }}>
              O módulo <strong style={{ color: T.accentBlue }}>{paginaAtiva}</strong> será implementado em breve.
            </p>
          </div>
        )
    }
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full" style={{ background: T.bg }}>
          <ToastContainer toasts={toasts} onRemover={removerToast} />

          <AppSidebar paginaAtiva={paginaAtiva} onNavegar={setPaginaAtiva} perfil={usuario.perfil} modulosPermitidos={permissoes?.modulos} />

          <div className="flex flex-col flex-1 min-w-0">
            {/* Topbar */}
            <header
              style={{
                ...glass(0.4, 16),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 20px',
                borderLeft: 'none',
                borderRight: 'none',
                borderTop: 'none',
                boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <SidebarTrigger style={{ color: T.textMuted }} />
                <button
                  onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); onVoltarHub() }}
                  style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 6,
                    color: T.accentBlue, background: `${T.accentBlue}11`,
                    border: `1px solid ${T.accentBlue}33`, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}22`
                    ;(e.currentTarget as HTMLElement).style.borderColor = T.accentBlue
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}11`
                    ;(e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}33`
                  }}
                >
                  ← Baia 360
                </button>
                <span style={{ color: T.border, fontSize: 16, userSelect: 'none' }}>|</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                  Central de Relatórios
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); setPaginaAtiva('perfil') }}
                  style={{
                    ...glass(0.2, 10),
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = T.borderHover}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = T.border}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: `linear-gradient(135deg, ${T.navy}, ${T.accentBlue}44)`,
                    border: `1px solid ${T.gold}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: T.gold, flexShrink: 0,
                  }}>
                    {(usuario.nome.trim().split(' ').length === 1
                      ? usuario.nome.slice(0, 2)
                      : usuario.nome.trim().split(' ')[0][0] + usuario.nome.trim().split(' ').slice(-1)[0][0]
                    ).toUpperCase()}
                  </div>
                  <span style={{ fontSize: 13, color: T.textMuted }}>{usuario.nome.split(' ')[0]}</span>
                </button>
                <button
                  onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); onLogout() }}
                  style={{
                    ...glass(0.2, 10),
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                    transition: 'all 0.15s', color: T.textMuted,
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = T.accentRed + '55'
                    el.style.color = T.accentRed
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = T.border
                    el.style.color = T.textMuted
                  }}
                >
                  <LogOut size={13} />
                  <span style={{ fontSize: 13 }}>Sair</span>
                </button>
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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg }}>
      <header style={{
        ...glass(0.4, 16),
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 48,
        borderLeft: 'none', borderRight: 'none', borderTop: 'none',
        boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); onVoltar() }}
            style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 6,
              color: T.accentBlue, background: `${T.accentBlue}11`,
              border: `1px solid ${T.accentBlue}33`, cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}22`
              ;(e.currentTarget as HTMLElement).style.borderColor = T.accentBlue
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}11`
              ;(e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}33`
            }}
          >
            ← Baia 360
          </button>
          <span style={{ color: T.border, fontSize: 16, userSelect: 'none' }}>|</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{icone} {titulo}</span>
        </div>
        <button
          onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); onPerfil() }}
          style={{
            ...glass(0.2, 10),
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = T.borderHover}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = T.border}
        >
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: `linear-gradient(135deg, ${T.navy}, ${T.accentBlue}44)`,
            border: `1px solid ${T.gold}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: T.gold,
          }}>
            {iniciais}
          </div>
          <span style={{ fontSize: 13, color: T.textMuted }}>{usuario.nome.split(' ')[0]}</span>
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
      <div key={tela} className="page-fade">
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
      </div>
    </>
  )
if (tela === 'painel_controle') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <div key={tela} className="page-fade">
        <PaginaSimples titulo="Painel de Controle" icone="📡" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
          <PainelControle />
        </PaginaSimples>
      </div>
    </>
  )

  if (tela === 'painel_resultados') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <div key={tela} className="page-fade">
        <PaginaSimples titulo="Painel de Resultados" icone="📈" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
          <PainelResultados />
        </PaginaSimples>
      </div>
    </>
  )

  if (tela === 'agenda') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <div key={tela} className="page-fade">
        <PaginaSimples titulo="Agenda" icone="📅" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
          <Agenda />
        </PaginaSimples>
      </div>
    </>
  )

  if (tela === 'usuarios') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <div key={tela} className="page-fade">
        <PaginaSimples titulo="Usuários" icone="👥" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
          <Usuarios />
        </PaginaSimples>
      </div>
    </>
  )

  if (tela === 'base_conhecimento') return (
    <>
      <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
      <div key={tela} className="page-fade">
        <PaginaSimples titulo="Base de Conhecimento" icone="🧠" usuario={usuario} onVoltar={() => setTela('hub')} onPerfil={() => { setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}>
          <BaseConhecimento />
        </PaginaSimples>
      </div>
    </>
  )

  if (tela === 'atlas') return (
  <>
  <ToastContainer toasts={toastsGlobais} onRemover={removerToastGlobal} />
  <div key={tela} className="page-fade" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1117' }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 48, borderBottom: '1px solid #2d3148', background: '#13161f', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); const evt = new CustomEvent('atlas-toggle-sidebar'); window.dispatchEvent(evt) }} style={{ width: 32, height: 32, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#8892a4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative', overflow: 'hidden' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
        <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); setTela('hub') }} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, color: '#7c3aed', background: '#7c3aed11', border: '1px solid #7c3aed33', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
          ← Baia 360
        </button>
        <span style={{ color: '#2d3148' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>🤖 Atlas</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); setPaginaInicialRelatorios('perfil'); setTela('relatorios') }}
          title="Meu perfil"
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 8, transition: 'background .12s', position: 'relative', overflow: 'hidden' }}
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
  <div key={tela} className="page-fade">
    <Dashboard
      usuario={usuario}
      onLogout={handleLogout}
      onVoltarHub={() => { setPaginaInicialRelatorios('home'); setTela('hub') }}
      onAtualizarUsuario={u => setUsuario(u)}
      paginaInicial={paginaInicialRelatorios}
      permissoes={permissoes}
    />
  </div>
)
}