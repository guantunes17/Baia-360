import { useState, useEffect } from 'react'
import axios from 'axios'
import { T } from '@/lib/theme'
import { glass, neoShadow, neoShadowInset } from '@/lib/glass'
import { API } from '@/config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

interface Usuario {
  id:     number
  nome:   string
  email:  string
  perfil: string
}

interface Props {
  usuario:     Usuario
  onAtualizar: (u: Usuario) => void
}

function getIniciais(nome: string) {
  const partes = nome.trim().split(' ')
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  background: 'rgba(8,11,20,0.7)',
  border: `1px solid ${T.border}`,
  borderRadius: 8, color: T.text, fontSize: 13,
  outline: 'none', boxShadow: neoShadowInset,
  boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 10, color: T.textMuted,
  marginBottom: 6, fontWeight: 500,
  textTransform: 'uppercase', letterSpacing: '0.08em',
}

export function Perfil({ usuario, onAtualizar }: Props) {
  const [nome,       setNome]       = useState(usuario.nome)
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha,  setNovaSenha]  = useState('')
  const [confirmar,  setConfirmar]  = useState('')
  const [salvando,   setSalvando]   = useState(false)
  const [sucesso,    setSucesso]    = useState('')
  const [erro,       setErro]       = useState('')

  const [outlookStatus, setOutlookStatus] = useState<{
    conectado: boolean
    email_outlook?: string
    expira_em?: string
  } | null>(null)
  const [conectandoOutlook, setConectandoOutlook] = useState(false)

  useEffect(() => {
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
      const popup = window.open(auth_url, 'outlook_auth', 'width=520,height=640,scrollbars=yes')
      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'OUTLOOK_CONNECTED') {
          window.removeEventListener('message', handler)
          popup?.close()
          setOutlookStatus({ conectado: true, email_outlook: event.data.email })
          setConectandoOutlook(false)
        }
      }
      window.addEventListener('message', handler)
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

  const cardStyle = (accentColor: string = T.accentBlue): React.CSSProperties => ({
    ...glass(0.35, 20),
    boxShadow: neoShadow,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden' as const,
    borderColor: `${accentColor}20`,
  })

  return (
    <div style={{ padding: '32px 40px', maxWidth: 560 }}>

      {/* Header avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: `${T.accentBlue}22`, border: `2px solid ${T.accentBlue}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 700, color: T.accentBlue, flexShrink: 0
        }}>
          {iniciais}
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            {usuario.nome}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
              background: isAdmin ? `${T.accentBlue}22` : `${T.textMuted}22`,
              color:      isAdmin ? T.accentBlue : T.textMuted,
              border:     `1px solid ${isAdmin ? T.accentBlue + '44' : T.textMuted + '44'}`
            }}>
              {isAdmin ? 'Administrador' : 'Usuário'}
            </span>
            <span style={{ fontSize: 11, color: T.textMuted }}>{usuario.email}</span>
          </div>
        </div>
      </div>

      {/* Dados pessoais */}
      <div style={cardStyle()}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentBlue}` }}>Dados pessoais</span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>Email</label>
            <input value={usuario.email} disabled style={{ ...inp, color: T.textMuted }} />
            <p style={{ fontSize: 11, color: `${T.textMuted}55`, marginTop: 4 }}>O email não pode ser alterado.</p>
          </div>
        </div>
      </div>

      {/* Trocar senha */}
      <div style={cardStyle()}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentBlue}` }}>Trocar senha</span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Senha atual</label>
            <input type="password" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} placeholder="••••••••" style={inp} />
          </div>
          <div>
            <label style={lbl}>Nova senha</label>
            <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="••••••••" style={inp} />
          </div>
          <div>
            <label style={lbl}>Confirmar nova senha</label>
            <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} placeholder="••••••••" style={inp} />
          </div>
          <p style={{ fontSize: 11, color: `${T.textMuted}55` }}>Deixe em branco para não alterar a senha.</p>
        </div>
      </div>

      {/* Integrações */}
      <div style={cardStyle(T.accentPurple)}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentPurple}` }}>Integrações</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#0078d422', border: '1px solid #0078d444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="13" height="16" rx="2" fill="#0078d4"/>
                  <rect x="9" y="8" width="13" height="12" rx="2" fill="#0096d6"/>
                  <path d="M9 8h13v2H9z" fill="#50e6ff" opacity="0.3"/>
                  <circle cx="8" cy="12" r="3" fill="white"/>
                  <text x="8" y="15.5" textAnchor="middle" fontSize="5" fontWeight="bold" fill="#0078d4">O</text>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: T.text }}>Microsoft 365</div>
                {outlookStatus === null && (
                  <div style={{ fontSize: 11, color: T.textMuted }}>Verificando...</div>
                )}
                {outlookStatus?.conectado && (
                  <div style={{ fontSize: 11, color: T.accentGreen }}>
                    Conectado — {outlookStatus.email_outlook || ''}
                  </div>
                )}
                {outlookStatus && !outlookStatus.conectado && (
                  <div style={{ fontSize: 11, color: T.textMuted }}>Não conectado</div>
                )}
              </div>
            </div>
            <div>
              {outlookStatus?.conectado ? (
                <button
                  onClick={desconectarOutlook}
                  style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, color: T.accentRed, background: `${T.accentRed}11`, border: `1px solid ${T.accentRed}33`, cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${T.accentRed}22`)}
                  onMouseLeave={e => (e.currentTarget.style.background = `${T.accentRed}11`)}
                >
                  Desconectar
                </button>
              ) : (
                <button
                  onClick={conectarOutlook}
                  disabled={conectandoOutlook || outlookStatus === null}
                  style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, color: '#0078d4', background: '#0078d411', border: '1px solid #0078d433', cursor: conectandoOutlook ? 'not-allowed' : 'pointer', opacity: conectandoOutlook ? 0.6 : 1 }}
                  onMouseEnter={e => { if (!conectandoOutlook) (e.currentTarget.style.background = '#0078d422') }}
                  onMouseLeave={e => { if (!conectandoOutlook) (e.currentTarget.style.background = '#0078d411') }}
                >
                  {conectandoOutlook ? 'Conectando...' : 'Conectar'}
                </button>
              )}
            </div>
          </div>
          <p style={{ fontSize: 11, color: `${T.textMuted}55`, marginTop: 4 }}>
            Necessário para o Atlas acessar sua agenda, e-mails e o Microsoft Teams.
          </p>
        </div>
      </div>

      {erro    && <p style={{ fontSize: 13, color: T.accentRed,   marginBottom: 16 }}>{erro}</p>}
      {sucesso && <p style={{ fontSize: 13, color: T.accentGreen, marginBottom: 16 }}>{sucesso}</p>}

      <button
        onClick={salvar}
        disabled={salvando}
        style={{ background: T.accentBlue, border: 'none', borderRadius: 8, color: 'white', padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: salvando ? 'not-allowed' : 'pointer', opacity: salvando ? 0.7 : 1 }}
      >
        {salvando ? 'Salvando...' : 'Salvar alterações'}
      </button>
    </div>
  )
}
