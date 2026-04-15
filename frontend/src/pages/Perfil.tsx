import { useState, useEffect } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { API } from '@/config'
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

interface Usuario {
  id: number
  nome: string
  email: string
  perfil: string
}

interface Props {
  usuario: Usuario
  onAtualizar: (u: Usuario) => void
}

function getIniciais(nome: string) {
  const partes = nome.trim().split(' ')
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

export function Perfil({ usuario, onAtualizar }: Props) {
  const [nome, setNome]             = useState(usuario.nome)
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha, setNovaSenha]   = useState('')
  const [confirmar, setConfirmar]   = useState('')
  const [salvando, setSalvando]     = useState(false)
  const [sucesso, setSucesso]       = useState('')
  const [erro, setErro]             = useState('')

  // ── Outlook ─────────────────────────────────────────────────────────────────
  const [outlookStatus, setOutlookStatus] = useState<{
    conectado: boolean
    email_outlook?: string
    expira_em?: string
  } | null>(null)
  const [conectandoOutlook, setConectandoOutlook] = useState(false)

  useEffect(() => {
    // Verifica status da conexão Outlook ao montar
    fetch(`${API}/api/oauth/outlook/status`, { headers: headers() })
      .then(r => r.json())
      .then(d => setOutlookStatus(d))
      .catch(() => setOutlookStatus({ conectado: false }))
  }, [])

  const conectarOutlook = async () => {
    setConectandoOutlook(true)
    try {
      const res = await fetch(`${API}/api/oauth/outlook/login`, { headers: headers() })
      const { auth_url } = await res.json()
      // Abre popup de autenticação Microsoft
      const popup = window.open(auth_url, 'outlook_auth', 'width=520,height=640,scrollbars=yes')
      // Escuta o postMessage do callback quando o popup fechar
      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'OUTLOOK_CONNECTED') {
          window.removeEventListener('message', handler)
          popup?.close()
          setOutlookStatus({ conectado: true, email_outlook: event.data.email })
          setConectandoOutlook(false)
        }
      }
      window.addEventListener('message', handler)
      // Fallback: se o popup fechar sem postMessage, verifica status
      const intervalo = setInterval(() => {
        if (popup?.closed) {
          clearInterval(intervalo)
          window.removeEventListener('message', handler)
          fetch(`${API}/api/oauth/outlook/status`, { headers: headers() })
            .then(r => r.json())
            .then(d => setOutlookStatus(d))
            .finally(() => setConectandoOutlook(false))
        }
      }, 800)
    } catch {
      setConectandoOutlook(false)
    }
  }

  const desconectarOutlook = async () => {
    await fetch(`${API}/api/oauth/outlook/desconectar`, { method: 'DELETE', headers: headers() })
    setOutlookStatus({ conectado: false })
  }

  const iniciais = getIniciais(usuario.nome)
  const isAdmin  = usuario.perfil === 'admin'

  const salvar = async () => {
    setErro('')
    setSucesso('')
    if (novaSenha && novaSenha !== confirmar) { setErro('As senhas não coincidem.'); return }
    if (novaSenha && !senhaAtual) { setErro('Informe a senha atual para trocar a senha.'); return }
    setSalvando(true)
    try {
      const payload: any = { nome }
      if (novaSenha) { payload.senha_atual = senhaAtual; payload.nova_senha = novaSenha }
      const res = await axios.put(`${API}/api/auth/perfil`, payload, { headers: headers() })
      localStorage.setItem('usuario', JSON.stringify(res.data))
      onAtualizar(res.data)
      setSucesso('Perfil atualizado com sucesso!')
      setSenhaAtual(''); setNovaSenha(''); setConfirmar('')
    } catch (err: any) {
      setErro(err.response?.data?.erro || 'Erro ao salvar perfil')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="p-8 max-w-xl">

      {/* Header com avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: '#4f8ef722', border: '2px solid #4f8ef744',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 700, color: '#4f8ef7', flexShrink: 0
        }}>
          {iniciais}
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
            {usuario.nome}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
              background: isAdmin ? '#4f8ef722' : '#8892a422',
              color:      isAdmin ? '#4f8ef7'   : '#8892a4',
              border:     `0.5px solid ${isAdmin ? '#4f8ef744' : '#8892a444'}`
            }}>
              {isAdmin ? 'Administrador' : 'Usuário'}
            </span>
            <span style={{ fontSize: 11, color: '#8892a4' }}>{usuario.email}</span>
          </div>
        </div>
      </div>

      {/* Dados pessoais */}
      <Card className="mb-4 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold" style={{ color: '#e2e8f0', paddingLeft: '10px', borderLeft: '2px solid #4f8ef7' }}>
            Dados pessoais
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label style={{ color: '#8892a4', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Nome</Label>
            <Input
              value={nome}
              onChange={e => setNome(e.target.value)}
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
          </div>
          <div className="space-y-1">
            <Label style={{ color: '#8892a4', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Email</Label>
            <Input
              value={usuario.email}
              disabled
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#8892a4' }}
            />
            <p className="text-xs" style={{ color: '#8892a455' }}>O email não pode ser alterado.</p>
          </div>
        </CardContent>
      </Card>

      {/* Trocar senha */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold" style={{ color: '#e2e8f0', paddingLeft: '10px', borderLeft: '2px solid #4f8ef7' }}>
            Trocar senha
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label style={{ color: '#8892a4', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Senha atual</Label>
            <Input type="password" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} placeholder="••••••••"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }} />
          </div>
          <div className="space-y-1">
            <Label style={{ color: '#8892a4', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Nova senha</Label>
            <Input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="••••••••"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }} />
          </div>
          <div className="space-y-1">
            <Label style={{ color: '#8892a4', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Confirmar nova senha</Label>
            <Input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} placeholder="••••••••"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }} />
          </div>
          <p style={{ fontSize: 11, color: '#8892a455' }}>Deixe em branco para não alterar a senha.</p>
        </CardContent>
      </Card>

      {/* Integrações */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold" style={{ color: '#e2e8f0', paddingLeft: '10px', borderLeft: '2px solid #7c3aed' }}>
            Integrações
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Ícone Outlook */}
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#0078d422', border: '0.5px solid #0078d444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="13" height="16" rx="2" fill="#0078d4"/>
                  <rect x="9" y="8" width="13" height="12" rx="2" fill="#0096d6"/>
                  <path d="M9 8h13v2H9z" fill="#50e6ff" opacity="0.3"/>
                  <circle cx="8" cy="12" r="3" fill="white"/>
                  <text x="8" y="15.5" textAnchor="middle" fontSize="5" fontWeight="bold" fill="#0078d4">O</text>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0' }}>Microsoft 365</div>
                {outlookStatus === null && (
                  <div style={{ fontSize: 11, color: '#8892a4' }}>Verificando...</div>
                )}
                {outlookStatus?.conectado && (
                  <div style={{ fontSize: 11, color: '#10b981' }}>
                    Conectado — {outlookStatus.email_outlook || ''}
                  </div>
                )}
                {outlookStatus && !outlookStatus.conectado && (
                  <div style={{ fontSize: 11, color: '#8892a4' }}>Não conectado</div>
                )}
              </div>
            </div>
            <div>
              {outlookStatus?.conectado ? (
                <button
                  onClick={desconectarOutlook}
                  style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, color: '#ef4444', background: '#ef444411', border: '0.5px solid #ef444433', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#ef444422')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#ef444411')}
                >
                  Desconectar
                </button>
              ) : (
                <button
                  onClick={conectarOutlook}
                  disabled={conectandoOutlook || outlookStatus === null}
                  style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, color: '#0078d4', background: '#0078d411', border: '0.5px solid #0078d433', cursor: conectandoOutlook ? 'not-allowed' : 'pointer', opacity: conectandoOutlook ? 0.6 : 1 }}
                  onMouseEnter={e => { if (!conectandoOutlook) (e.currentTarget.style.background = '#0078d422') }}
                  onMouseLeave={e => { if (!conectandoOutlook) (e.currentTarget.style.background = '#0078d411') }}
                >
                  {conectandoOutlook ? 'Conectando...' : 'Conectar'}
                </button>
              )}
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#8892a455', marginTop: 4 }}>
            Necessário para o Atlas acessar sua agenda, e-mails e o Microsoft Teams.
          </p>
        </CardContent>
      </Card>

      {erro    && <p className="text-sm mb-4" style={{ color: '#ef4444' }}>{erro}</p>}
      {sucesso && <p className="text-sm mb-4" style={{ color: '#10b981' }}>{sucesso}</p>}

      <Button onClick={salvar} disabled={salvando} style={{ background: '#4f8ef7', color: 'white' }}>
        {salvando ? 'Salvando...' : 'Salvar alterações'}
      </Button>
    </div>
  )
}