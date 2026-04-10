import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { API } from '../config'

interface Usuario {
  id: number
  nome: string
  email: string
  perfil: string
  ativo: boolean
  status: string
  criado_em: string
}

const token = () => localStorage.getItem('token')
const headers = () => ({ Authorization: `Bearer ${token()}` })

const PERFIS = [
  { value: 'operacional', label: 'Operacional' },
  { value: 'analista',    label: 'Analista' },
  { value: 'financeiro',  label: 'Financeiro' },
  { value: 'admin',       label: 'Administrador' },
]

function badgePerfil(perfil: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    admin:       { bg: '#E6F1FB', color: '#0C447C', label: 'Admin' },
    analista:    { bg: '#EEEDFE', color: '#3C3489', label: 'Analista' },
    financeiro:  { bg: '#FAEEDA', color: '#633806', label: 'Financeiro' },
    operacional: { bg: '#E1F5EE', color: '#085041', label: 'Operacional' },
  }
  const s = map[perfil] || { bg: '#8892a422', color: '#8892a4', label: perfil }
  return (
    <span style={{ fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.color, flexShrink: 0 }}>
      {s.label}
    </span>
  )
}

function badgeStatus(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    ativo:     { bg: '#EAF3DE', color: '#27500A', label: 'Ativo' },
    pendente:  { bg: '#FAEEDA', color: '#633806', label: 'Pendente' },
    rejeitado: { bg: '#FCEBEB', color: '#791F1F', label: 'Rejeitado' },
    inativo:   { bg: '#8892a422', color: '#8892a4', label: 'Inativo' },
  }
  const s = map[status] || { bg: '#8892a422', color: '#8892a4', label: status }
  return (
    <span style={{ fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.color, flexShrink: 0 }}>
      {s.label}
    </span>
  )
}

export function Usuarios() {
  const [usuarios, setUsuarios]             = useState<Usuario[]>([])
  const [loading, setLoading]               = useState(true)
  const [erro, setErro]                     = useState('')

  const [modalAberto, setModalAberto]       = useState(false)
  const [editando, setEditando]             = useState<Usuario | null>(null)
  const [form, setForm]                     = useState({ nome: '', email: '', senha: '', perfil: 'operacional' })
  const [salvando, setSalvando]             = useState(false)
  const [erroModal, setErroModal]           = useState('')

  const [modalSenha, setModalSenha]         = useState(false)
  const [usuarioSenha, setUsuarioSenha]     = useState<Usuario | null>(null)
  const [novaSenha, setNovaSenha]           = useState('')
  const [salvandoSenha, setSalvandoSenha]   = useState(false)

  const [modalDeletar, setModalDeletar]     = useState(false)
  const [usuarioDeletar, setUsuarioDeletar] = useState<Usuario | null>(null)

  const [aprovandoId, setAprovandoId]       = useState<number | null>(null)
  const [perfilAprovacao, setPerfilAprovacao] = useState<Record<number, string>>({})

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
      await axios.put(`${API}/api/auth/usuarios/${u.id}`,
        { ativo: !u.ativo },
        { headers: headers() })
      carregar()
    } catch {
      alert('Erro ao atualizar status')
    }
  }

  const deletar = async () => {
    if (!usuarioDeletar) return
    try {
      await axios.delete(`${API}/api/auth/usuarios/${usuarioDeletar.id}`,
        { headers: headers() })
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
      await axios.post(`${API}/api/auth/usuarios/${u.id}/rejeitar`,
        {},
        { headers: headers() })
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

  const avatarColors: Record<string, { bg: string; color: string }> = {
    admin:       { bg: '#E6F1FB', color: '#0C447C' },
    analista:    { bg: '#EEEDFE', color: '#3C3489' },
    financeiro:  { bg: '#FAEEDA', color: '#633806' },
    operacional: { bg: '#E1F5EE', color: '#085041' },
  }

  const renderRow = (u: Usuario, isPendente = false) => {
    const av = avatarColors[u.perfil] || { bg: '#8892a422', color: '#8892a4' }
    return (
      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: '0.5px solid #2d3148', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: av.bg, border: `0.5px solid ${av.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: av.color, flexShrink: 0 }}>
          {iniciais(u.nome)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{u.nome}</div>
          <div style={{ fontSize: 11, color: '#8892a4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
        </div>
        <div style={{ fontSize: 11, color: '#8892a4', flexShrink: 0 }}>
          {new Date(u.criado_em).toLocaleDateString('pt-BR')}
        </div>

        {isPendente ? (
          <>
            {badgeStatus('pendente')}
            <select
              value={perfilAprovacao[u.id] || 'analista'}
              onChange={e => setPerfilAprovacao(p => ({ ...p, [u.id]: e.target.value }))}
              style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '0.5px solid #2d3148', background: '#0f1117', color: '#e2e8f0', flexShrink: 0 }}
            >
              {PERFIS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button
              onClick={() => aprovar(u)}
              disabled={aprovandoId === u.id}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #639922', background: '#EAF3DE', color: '#27500A', cursor: 'pointer', flexShrink: 0 }}
            >
              {aprovandoId === u.id ? '...' : 'Aprovar'}
            </button>
            <button
              onClick={() => rejeitar(u)}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #E24B4A', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer', flexShrink: 0 }}
            >
              Rejeitar
            </button>
          </>
        ) : (
          <>
            {badgePerfil(u.perfil)}
            {badgeStatus(u.status || (u.ativo ? 'ativo' : 'inativo'))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" style={{ color: '#8892a4', flexShrink: 0 }}>···</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
                <DropdownMenuItem onClick={() => abrirEditar(u)} style={{ color: '#e2e8f0', cursor: 'pointer' }}>✏️ Editar</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setUsuarioSenha(u); setModalSenha(true) }} style={{ color: '#e2e8f0', cursor: 'pointer' }}>🔑 Redefinir Senha</DropdownMenuItem>
                <DropdownMenuItem onClick={() => toggleAtivo(u)} style={{ color: u.ativo ? '#ef4444' : '#10b981', cursor: 'pointer' }}>{u.ativo ? '🚫 Desativar' : '✅ Ativar'}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setUsuarioDeletar(u); setModalDeletar(true) }} style={{ color: '#ef4444', cursor: 'pointer' }}>🗑️ Deletar</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="p-8">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#e2e8f0', margin: 0 }}>Gestão de Usuários</h1>
          <p style={{ fontSize: 13, color: '#8892a4', marginTop: 4 }}>{usuarios.length} usuário{usuarios.length !== 1 ? 's' : ''} cadastrado{usuarios.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={abrirCriar} style={{ background: '#4f8ef7', color: 'white' }}>+ Novo Usuário</Button>
      </div>

      {erro && <p style={{ color: '#ef4444', marginBottom: 16 }}>{erro}</p>}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#8892a4', fontSize: 13 }}>Carregando...</div>
      ) : (
        <div style={{ borderRadius: 10, border: '0.5px solid #2d3148', background: '#1a1d27', padding: '0 16px' }}>

          {pendentes.length > 0 && (
            <>
              <div style={{ padding: '12px 0 6px', fontSize: 11, fontWeight: 500, color: '#633806', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Aprovações pendentes ({pendentes.length})
              </div>
              {pendentes.map(u => renderRow(u, true))}
              <div style={{ height: 0.5, background: '#2d3148', margin: '4px 0 0' }} />
              <div style={{ padding: '12px 0 6px', fontSize: 11, fontWeight: 500, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Usuários
              </div>
            </>
          )}

          {ativos.length === 0 && pendentes.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#8892a4', fontSize: 13 }}>Nenhum usuário cadastrado.</div>
          )}

          {ativos.map(u => renderRow(u, false))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#e2e8f0' }}>{editando ? '✏️ Editar Usuário' : '+ Novo Usuário'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Nome</Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }} />
            </div>
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@baia4.com.br" style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }} />
            </div>
            {!editando && (
              <div className="space-y-2">
                <Label style={{ color: '#8892a4' }}>Senha</Label>
                <Input type="password" value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} placeholder="Mínimo 8 caracteres" style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }} />
              </div>
            )}
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Perfil</Label>
              <select value={form.perfil} onChange={e => setForm({ ...form, perfil: e.target.value })} className="w-full rounded-md border px-3 py-2 text-sm" style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}>
                {PERFIS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            {erroModal && <p style={{ color: '#ef4444', fontSize: 13 }}>{erroModal}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalAberto(false)} style={{ borderColor: '#4a5568', color: '#e2e8f0', background: 'transparent' }}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando} style={{ background: '#4f8ef7', color: 'white' }}>{salvando ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Redefinir Senha */}
      <Dialog open={modalSenha} onOpenChange={setModalSenha}>
        <DialogContent style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#e2e8f0' }}>🔑 Redefinir Senha — {usuarioSenha?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Nova Senha</Label>
              <Input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="Mínimo 8 caracteres" style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalSenha(false)} style={{ borderColor: '#4a5568', color: '#e2e8f0', background: 'transparent' }}>Cancelar</Button>
            <Button onClick={salvarSenha} disabled={salvandoSenha || novaSenha.length < 8} style={{ background: '#4f8ef7', color: 'white' }}>{salvandoSenha ? 'Salvando...' : 'Redefinir'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Deletar */}
      <AlertDialog open={modalDeletar} onOpenChange={setModalDeletar}>
        <AlertDialogContent style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: '#e2e8f0' }}>Deletar usuário?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: '#8892a4' }}>
              Tem certeza que deseja deletar <strong style={{ color: '#e2e8f0' }}>{usuarioDeletar?.nome}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel style={{ background: 'transparent', borderColor: '#4a5568', color: '#e2e8f0' }}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deletar} style={{ background: '#ef4444', color: 'white' }}>Deletar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}