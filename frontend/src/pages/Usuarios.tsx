import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { T } from '@/lib/theme'
import { glass, neoShadow, neoShadowInset } from '@/lib/glass'
import { addRipple } from '@/lib/ripple'
import { API } from '../config'

interface Usuario {
  id:        number
  nome:      string
  email:     string
  perfil:    string
  ativo:     boolean
  status:    string
  criado_em: string
}

const token   = () => localStorage.getItem('token')
const headers = () => ({ Authorization: `Bearer ${token()}` })

const PERFIS = [
  { value: 'operacional', label: 'Operacional' },
  { value: 'analista',    label: 'Analista' },
  { value: 'financeiro',  label: 'Financeiro' },
  { value: 'admin',       label: 'Administrador' },
]

const MODULOS_DISPONIVEIS = [
  { key: 'pedidos',         label: 'Pedidos e Recebimentos' },
  { key: 'fretes',          label: 'Fretes' },
  { key: 'armazenagem',     label: 'Armazenagem' },
  { key: 'estoque',         label: 'Estoque' },
  { key: 'cap_operacional', label: 'Capacidade Operacional' },
  { key: 'recebimentos',    label: 'Recebimentos e Devoluções' },
  { key: 'fat_dist',        label: 'Faturamento Distribuição' },
  { key: 'fat_arm',         label: 'Faturamento Armazenagem' },
]

const HUB_ITEMS = [
  { key: 'central',           label: 'Central de Relatórios' },
  { key: 'painel_controle',   label: 'Painel de Controle' },
  { key: 'painel_resultados', label: 'Painel de Resultados' },
  { key: 'agenda',            label: 'Agenda' },
]

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  background: 'rgba(8,11,20,0.7)',
  border: `1px solid ${T.border}`,
  borderRadius: 8, color: T.text, fontSize: 13,
  outline: 'none', boxShadow: neoShadowInset,
  boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, color: T.textMuted,
  marginBottom: 6, fontWeight: 500,
}

const PERFIL_CORES: Record<string, string> = {
  admin: T.accentBlue, analista: T.accentPurple,
  financeiro: T.accentAmber, operacional: T.accentGreen,
}

function badgePerfil(perfil: string) {
  const cor   = PERFIL_CORES[perfil] || T.textMuted
  const label = PERFIS.find(p => p.value === perfil)?.label || perfil
  return (
    <span style={{ fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 99, background: `${cor}22`, color: cor, flexShrink: 0 }}>
      {label}
    </span>
  )
}

function badgeStatus(status: string) {
  const map: Record<string, { cor: string; label: string }> = {
    ativo:     { cor: T.accentGreen,  label: 'Ativo' },
    pendente:  { cor: T.accentAmber,  label: 'Pendente' },
    rejeitado: { cor: T.accentRed,    label: 'Rejeitado' },
    inativo:   { cor: T.textMuted,    label: 'Inativo' },
  }
  const s = map[status] || { cor: T.textMuted, label: status }
  return (
    <span style={{ fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 99, background: `${s.cor}22`, color: s.cor, flexShrink: 0 }}>
      {s.label}
    </span>
  )
}

export function Usuarios() {
  const [usuarios,      setUsuarios]      = useState<Usuario[]>([])
  const [loading,       setLoading]       = useState(true)
  const [erro,          setErro]          = useState('')
  const [openMenuId,    setOpenMenuId]    = useState<number | null>(null)

  const [modalAberto,   setModalAberto]   = useState(false)
  const [editando,      setEditando]      = useState<Usuario | null>(null)
  const [form,          setForm]          = useState({ nome: '', email: '', senha: '', perfil: 'operacional' })
  const [salvando,      setSalvando]      = useState(false)
  const [erroModal,     setErroModal]     = useState('')

  const [modalSenha,    setModalSenha]    = useState(false)
  const [usuarioSenha,  setUsuarioSenha]  = useState<Usuario | null>(null)
  const [novaSenha,     setNovaSenha]     = useState('')
  const [salvandoSenha, setSalvandoSenha] = useState(false)

  const [modalDeletar,    setModalDeletar]    = useState(false)
  const [usuarioDeletar,  setUsuarioDeletar]  = useState<Usuario | null>(null)

  const [aprovandoId,     setAprovandoId]     = useState<number | null>(null)
  const [perfilAprovacao, setPerfilAprovacao] = useState<Record<number, string>>({})

  const [painelPermissoes, setPainelPermissoes] = useState<Usuario | null>(null)
  const [permissoes,       setPermissoes]       = useState<{ hub: string[]; modulos: string[] }>({ hub: [], modulos: [] })
  const [salvandoPerm,     setSalvandoPerm]     = useState(false)

  const abrirPermissoes = async (u: Usuario) => {
    try {
      const res = await axios.get(`${API}/api/auth/usuarios/${u.id}/permissoes`, { headers: headers() })
      setPermissoes(res.data)
      setPainelPermissoes(u)
    } catch {
      alert('Erro ao carregar permissões')
    }
  }

  const salvarPermissoes = async () => {
    if (!painelPermissoes) return
    setSalvandoPerm(true)
    try {
      await axios.put(`${API}/api/auth/usuarios/${painelPermissoes.id}/permissoes`,
        permissoes, { headers: headers() })
      setPainelPermissoes(null)
    } catch {
      alert('Erro ao salvar permissões')
    } finally {
      setSalvandoPerm(false)
    }
  }

  const toggleHub    = (key: string) => setPermissoes(p => ({ ...p, hub:    p.hub.includes(key)    ? p.hub.filter(k => k !== key)    : [...p.hub, key] }))
  const toggleModulo = (m: string)   => setPermissoes(p => ({ ...p, modulos: p.modulos.includes(m) ? p.modulos.filter(k => k !== m) : [...p.modulos, m] }))

  const carregar = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API}/api/auth/usuarios`, { headers: headers() })
      setUsuarios(res.data)
      const init: Record<number, string> = {}
      res.data.forEach((u: Usuario) => { init[u.id] = 'analista' })
      setPerfilAprovacao(init)
    } catch {
      setErro('Erro ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  const pendentes = usuarios.filter(u => u.status === 'pendente')
  const ativos    = usuarios.filter(u => u.status !== 'pendente')

  const abrirCriar = () => {
    setEditando(null)
    setForm({ nome: '', email: '', senha: '', perfil: 'operacional' })
    setErroModal('')
    setModalAberto(true)
  }

  const abrirEditar = (u: Usuario) => {
    setEditando(u)
    setForm({ nome: u.nome, email: u.email, senha: '', perfil: u.perfil })
    setErroModal('')
    setModalAberto(true)
  }

  const salvar = async () => {
    setSalvando(true)
    setErroModal('')
    try {
      if (editando) {
        await axios.put(`${API}/api/auth/usuarios/${editando.id}`,
          { nome: form.nome, email: form.email, perfil: form.perfil },
          { headers: headers() })
      } else {
        await axios.post(`${API}/api/auth/usuarios`,
          { nome: form.nome, email: form.email, senha: form.senha, perfil: form.perfil },
          { headers: headers() })
      }
      setModalAberto(false)
      carregar()
    } catch (err: any) {
      setErroModal(err.response?.data?.erro || 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const salvarSenha = async () => {
    if (!usuarioSenha) return
    setSalvandoSenha(true)
    try {
      await axios.put(`${API}/api/auth/usuarios/${usuarioSenha.id}/senha`,
        { nova_senha: novaSenha },
        { headers: headers() })
      setModalSenha(false)
      setNovaSenha('')
    } catch (err: any) {
      alert(err.response?.data?.erro || 'Erro ao redefinir senha')
    } finally {
      setSalvandoSenha(false)
    }
  }

  const toggleAtivo = async (u: Usuario) => {
    try {
      await axios.put(`${API}/api/auth/usuarios/${u.id}`, { ativo: !u.ativo }, { headers: headers() })
      carregar()
    } catch {
      alert('Erro ao atualizar status')
    }
  }

  const deletar = async () => {
    if (!usuarioDeletar) return
    try {
      await axios.delete(`${API}/api/auth/usuarios/${usuarioDeletar.id}`, { headers: headers() })
      setModalDeletar(false)
      carregar()
    } catch (err: any) {
      alert(err.response?.data?.erro || 'Erro ao deletar')
    }
  }

  const aprovar = async (u: Usuario) => {
    setAprovandoId(u.id)
    try {
      await axios.post(`${API}/api/auth/usuarios/${u.id}/aprovar`,
        { perfil: perfilAprovacao[u.id] || 'analista' },
        { headers: headers() })
      carregar()
    } catch (err: any) {
      alert(err.response?.data?.erro || 'Erro ao aprovar')
    } finally {
      setAprovandoId(null)
    }
  }

  const rejeitar = async (u: Usuario) => {
    try {
      await axios.post(`${API}/api/auth/usuarios/${u.id}/rejeitar`, {}, { headers: headers() })
      carregar()
    } catch (err: any) {
      alert(err.response?.data?.erro || 'Erro ao rejeitar')
    }
  }

  const iniciais = (nome: string) => {
    const p = nome.trim().split(' ')
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
    return (p[0][0] + p[p.length - 1][0]).toUpperCase()
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
  }
  const modalInnerStyle: React.CSSProperties = {
    ...glass(0.98, 30), boxShadow: neoShadow, borderRadius: 14,
    padding: 28, width: 420, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto'
  }
  const modalTitle: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 20 }
  const btnCancel: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, border: `1px solid ${T.border}`,
    background: 'transparent', color: T.textMuted, cursor: 'pointer', fontSize: 13
  }
  const btnPrimary: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, border: 'none',
    background: T.accentBlue, color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600
  }

  const renderRow = (u: Usuario, isPendente = false) => {
    const cor = PERFIL_CORES[u.perfil] || T.textMuted
    const isMenuOpen = openMenuId === u.id

    return (
      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: `1px solid ${T.border}`, flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: `${cor}22`, border: `1px solid ${cor}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: cor, flexShrink: 0 }}>
          {iniciais(u.nome)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{u.nome}</div>
          <div style={{ fontSize: 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, flexShrink: 0 }}>
          {new Date(u.criado_em).toLocaleDateString('pt-BR')}
        </div>

        {isPendente ? (
          <>
            {badgeStatus('pendente')}
            <select
              value={perfilAprovacao[u.id] || 'analista'}
              onChange={e => setPerfilAprovacao(p => ({ ...p, [u.id]: e.target.value }))}
              style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.text, flexShrink: 0, outline: 'none' }}
            >
              {PERFIS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button
              onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); aprovar(u) }}
              disabled={aprovandoId === u.id}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.accentGreen}44`, background: `${T.accentGreen}18`, color: T.accentGreen, cursor: 'pointer', flexShrink: 0 }}
            >
              {aprovandoId === u.id ? '...' : 'Aprovar'}
            </button>
            <button
              onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); rejeitar(u) }}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.accentRed}44`, background: `${T.accentRed}18`, color: T.accentRed, cursor: 'pointer', flexShrink: 0 }}
            >
              Rejeitar
            </button>
          </>
        ) : (
          <>
            {badgePerfil(u.perfil)}
            {badgeStatus(u.status || (u.ativo ? 'ativo' : 'inativo'))}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setOpenMenuId(prev => prev === u.id ? null : u.id)}
                style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textMuted, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14 }}
              >···</button>
              {isMenuOpen && (
                <>
                  <div onClick={() => setOpenMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20, ...glass(0.98, 30), borderRadius: 8, minWidth: 200, padding: 4, boxShadow: neoShadow }}>
                    {[
                      { label: '✏️ Editar',          action: () => { abrirEditar(u); setOpenMenuId(null) },                                   color: T.text },
                      { label: '🔐 Permissões',       action: () => { abrirPermissoes(u); setOpenMenuId(null) },                               color: T.text },
                      { label: '🔑 Redefinir Senha',  action: () => { setUsuarioSenha(u); setModalSenha(true); setOpenMenuId(null) },           color: T.text },
                      { label: u.ativo ? '🚫 Desativar' : '✅ Ativar', action: () => { toggleAtivo(u); setOpenMenuId(null) }, color: u.ativo ? T.accentRed : T.accentGreen },
                      { label: '🗑️ Deletar',         action: () => { setUsuarioDeletar(u); setModalDeletar(true); setOpenMenuId(null) },        color: T.accentRed },
                    ].map((item, i) => (
                      <button
                        key={i}
                        onClick={item.action}
                        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: item.color, fontSize: 13, padding: '8px 14px', cursor: 'pointer', borderRadius: 6, display: 'block' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(14,22,45,0.6)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >{item.label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: T.text, margin: 0 }}>Gestão de Usuários</h1>
          <p style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>{usuarios.length} usuário{usuarios.length !== 1 ? 's' : ''} cadastrado{usuarios.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); abrirCriar() }} style={{ background: T.accentBlue, border: 'none', borderRadius: 8, color: 'white', padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
          + Novo Usuário
        </button>
      </div>

      {erro && <p style={{ color: T.accentRed, marginBottom: 16 }}>{erro}</p>}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>Carregando...</div>
      ) : (
        <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 12, padding: '0 16px' }}>

          {pendentes.length > 0 && (
            <>
              <div style={{ padding: '12px 0 6px', fontSize: 11, fontWeight: 500, color: T.accentAmber, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Aprovações pendentes ({pendentes.length})
              </div>
              {pendentes.map(u => renderRow(u, true))}
              <div style={{ height: 1, background: T.border, margin: '4px 0 0' }} />
              <div style={{ padding: '12px 0 6px', fontSize: 11, fontWeight: 500, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Usuários
              </div>
            </>
          )}

          {ativos.length === 0 && pendentes.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>Nenhum usuário cadastrado.</div>
          )}

          {ativos.map(u => renderRow(u, false))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      {modalAberto && (
        <div onClick={() => setModalAberto(false)} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={modalInnerStyle}>
            <div style={modalTitle}>{editando ? '✏️ Editar Usuário' : '+ Novo Usuário'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={lbl}>Nome</label><input value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} placeholder="Nome completo" style={inp} /></div>
              <div><label style={lbl}>Email</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="email@baia4.com.br" style={inp} /></div>
              {!editando && (
                <div><label style={lbl}>Senha</label><input type="password" value={form.senha} onChange={e => setForm({...form, senha: e.target.value})} placeholder="Mínimo 8 caracteres" style={inp} /></div>
              )}
              <div>
                <label style={lbl}>Perfil</label>
                <select value={form.perfil} onChange={e => setForm({...form, perfil: e.target.value})} style={{ ...inp, cursor: 'pointer' }}>
                  {PERFIS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              {erroModal && <p style={{ fontSize: 13, color: T.accentRed }}>{erroModal}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setModalAberto(false)} style={btnCancel}>Cancelar</button>
              <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); salvar() }} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Senha */}
      {modalSenha && (
        <div onClick={() => setModalSenha(false)} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalInnerStyle, width: 380 }}>
            <div style={modalTitle}>🔑 Redefinir Senha — {usuarioSenha?.nome}</div>
            <div><label style={lbl}>Nova Senha</label><input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="Mínimo 8 caracteres" style={inp} /></div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setModalSenha(false)} style={btnCancel}>Cancelar</button>
              <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); salvarSenha() }} disabled={salvandoSenha || novaSenha.length < 8} style={{ ...btnPrimary, opacity: salvandoSenha || novaSenha.length < 8 ? 0.5 : 1 }}>{salvandoSenha ? 'Salvando...' : 'Redefinir'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Deletar */}
      {modalDeletar && (
        <div onClick={() => setModalDeletar(false)} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalInnerStyle, width: 400 }}>
            <div style={modalTitle}>Deletar usuário?</div>
            <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 24 }}>
              Tem certeza que deseja deletar <strong style={{ color: T.text }}>{usuarioDeletar?.nome}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalDeletar(false)} style={btnCancel}>Cancelar</button>
              <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); deletar() }} style={{ ...btnPrimary, background: T.accentRed }}>Deletar</button>
            </div>
          </div>
        </div>
      )}

      {/* Painel Permissões */}
      {painelPermissoes && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...glass(0.98, 30), boxShadow: neoShadow, borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <p style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>🔐 Permissões — {painelPermissoes.nome}</p>
                <p style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>{badgePerfil(painelPermissoes.perfil)}</p>
              </div>
              <button onClick={() => setPainelPermissoes(null)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: T.accentBlue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, paddingLeft: 8, borderLeft: `2px solid ${T.accentBlue}` }}>
                Cards do Hub
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {HUB_ITEMS.map(item => (
                  <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, background: 'rgba(8,11,20,0.7)', border: `1px solid ${permissoes.hub.includes(item.key) ? T.accentBlue + '44' : T.border}` }}>
                    <input type="checkbox" checked={permissoes.hub.includes(item.key)} onChange={() => toggleHub(item.key)} style={{ accentColor: T.accentBlue, width: 15, height: 15 }} />
                    <span style={{ fontSize: 13, color: permissoes.hub.includes(item.key) ? T.text : T.textMuted }}>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: T.accentGreen, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, paddingLeft: 8, borderLeft: `2px solid ${T.accentGreen}` }}>
                Módulos da Central de Relatórios
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {MODULOS_DISPONIVEIS.map(modulo => (
                  <label key={modulo.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, background: 'rgba(8,11,20,0.7)', border: `1px solid ${permissoes.modulos.includes(modulo.key) ? T.accentGreen + '44' : T.border}` }}>
                    <input type="checkbox" checked={permissoes.modulos.includes(modulo.key)} onChange={() => toggleModulo(modulo.key)} style={{ accentColor: T.accentGreen, width: 15, height: 15 }} />
                    <span style={{ fontSize: 12, color: permissoes.modulos.includes(modulo.key) ? T.text : T.textMuted }}>{modulo.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 28, padding: '12px 14px', background: `${T.accentPurple}11`, border: `1px solid ${T.accentPurple}33`, borderRadius: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: T.accentPurple, marginBottom: 4 }}>🤖 Atlas</p>
              <p style={{ fontSize: 12, color: T.textMuted }}>Disponível para todos os usuários com acesso total.</p>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setPainelPermissoes(null)} style={btnCancel}>Cancelar</button>
              <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); salvarPermissoes() }} disabled={salvandoPerm} style={{ ...btnPrimary, opacity: salvandoPerm ? 0.7 : 1 }}>{salvandoPerm ? 'Salvando...' : 'Salvar Permissões'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
