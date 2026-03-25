import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
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
import { Badge } from '@/components/ui/badge'

const API = 'http://localhost:5000'

interface Usuario {
  id: number
  nome: string
  email: string
  perfil: string
  ativo: boolean
  criado_em: string
}

const token = () => localStorage.getItem('token')
const headers = () => ({ Authorization: `Bearer ${token()}` })

export function Usuarios() {
  const [usuarios, setUsuarios]       = useState<Usuario[]>([])
  const [loading, setLoading]         = useState(true)
  const [erro, setErro]               = useState('')

  // Modal criar/editar
  const [modalAberto, setModalAberto]       = useState(false)
  const [editando, setEditando]             = useState<Usuario | null>(null)
  const [form, setForm]                     = useState({ nome: '', email: '', senha: '', perfil: 'usuario' })
  const [salvando, setSalvando]             = useState(false)
  const [erroModal, setErroModal]           = useState('')

  // Modal redefinir senha
  const [modalSenha, setModalSenha]         = useState(false)
  const [usuarioSenha, setUsuarioSenha]     = useState<Usuario | null>(null)
  const [novaSenha, setNovaSenha]           = useState('')
  const [salvandoSenha, setSalvandoSenha]   = useState(false)

  // Modal deletar
  const [modalDeletar, setModalDeletar]     = useState(false)
  const [usuarioDeletar, setUsuarioDeletar] = useState<Usuario | null>(null)

  const carregar = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API}/api/auth/usuarios`, { headers: headers() })
      setUsuarios(res.data)
    } catch {
      setErro('Erro ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  const abrirCriar = () => {
    setEditando(null)
    setForm({ nome: '', email: '', senha: '', perfil: 'usuario' })
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

  return (
    <div className="p-8">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>
            👥 Gestão de Usuários
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8892a4' }}>
            {usuarios.length} usuário{usuarios.length !== 1 ? 's' : ''} cadastrado{usuarios.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          onClick={abrirCriar}
          style={{ background: '#4f8ef7', color: 'white' }}
        >
          + Novo Usuário
        </Button>
      </div>

      {/* Erro */}
      {erro && <p className="text-red-400 mb-4">{erro}</p>}

      {/* Tabela */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#2d3148' }}>
        <Table>
          <TableHeader>
            <TableRow style={{ background: '#13161f', borderColor: '#2d3148' }}>
              <TableHead style={{ color: '#8892a4' }}>Nome</TableHead>
              <TableHead style={{ color: '#8892a4' }}>Email</TableHead>
              <TableHead style={{ color: '#8892a4' }}>Perfil</TableHead>
              <TableHead style={{ color: '#8892a4' }}>Status</TableHead>
              <TableHead style={{ color: '#8892a4' }}>Criado em</TableHead>
              <TableHead style={{ color: '#8892a4' }}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8" style={{ color: '#8892a4' }}>
                  Carregando...
                </TableCell>
              </TableRow>
            ) : usuarios.map(u => (
              <TableRow key={u.id} style={{ borderColor: '#2d3148', background: '#1a1d27' }}>
                <TableCell className="font-medium" style={{ color: '#e2e8f0' }}>{u.nome}</TableCell>
                <TableCell style={{ color: '#8892a4' }}>{u.email}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: u.perfil === 'admin' ? '#4f8ef7' : '#2d3148',
                      color: u.perfil === 'admin' ? '#4f8ef7' : '#8892a4',
                    }}
                  >
                    {u.perfil}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: u.ativo ? '#10b981' : '#ef4444',
                      color: u.ativo ? '#10b981' : '#ef4444',
                    }}
                  >
                    {u.ativo ? 'Ativo' : 'Inativo'}
                  </Badge>
                </TableCell>
                <TableCell style={{ color: '#8892a4' }}>
                  {new Date(u.criado_em).toLocaleDateString('pt-BR')}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" style={{ color: '#8892a4' }}>
                        ···
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      style={{ background: '#1a1d27', borderColor: '#2d3148' }}
                    >
                      <DropdownMenuItem
                        onClick={() => abrirEditar(u)}
                        style={{ color: '#e2e8f0', cursor: 'pointer' }}
                      >
                        ✏️ Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => { setUsuarioSenha(u); setModalSenha(true) }}
                        style={{ color: '#e2e8f0', cursor: 'pointer' }}
                      >
                        🔑 Redefinir Senha
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => toggleAtivo(u)}
                        style={{ color: u.ativo ? '#ef4444' : '#10b981', cursor: 'pointer' }}
                      >
                        {u.ativo ? '🚫 Desativar' : '✅ Ativar'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => { setUsuarioDeletar(u); setModalDeletar(true) }}
                        style={{ color: '#ef4444', cursor: 'pointer' }}
                      >
                        🗑️ Deletar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Modal Criar/Editar */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#e2e8f0' }}>
              {editando ? '✏️ Editar Usuário' : '+ Novo Usuário'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Nome</Label>
              <Input
                value={form.nome}
                onChange={e => setForm({ ...form, nome: e.target.value })}
                placeholder="Nome completo"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
            </div>
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="email@baia4.com.br"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
            </div>
            {!editando && (
              <div className="space-y-2">
                <Label style={{ color: '#8892a4' }}>Senha</Label>
                <Input
                  type="password"
                  value={form.senha}
                  onChange={e => setForm({ ...form, senha: e.target.value })}
                  placeholder="Mínimo 6 caracteres"
                  style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Perfil</Label>
              <select
                value={form.perfil}
                onChange={e => setForm({ ...form, perfil: e.target.value })}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              >
                <option value="usuario">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            {erroModal && <p className="text-sm" style={{ color: '#ef4444' }}>{erroModal}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModalAberto(false)}
              style={{ borderColor: '#2d3148', color: '#8892a4', background: 'transparent' }}
            >
              Cancelar
            </Button>
            <Button
              onClick={salvar}
              disabled={salvando}
              style={{ background: '#4f8ef7', color: 'white' }}
            >
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Redefinir Senha */}
      <Dialog open={modalSenha} onOpenChange={setModalSenha}>
        <DialogContent style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#e2e8f0' }}>
              🔑 Redefinir Senha — {usuarioSenha?.nome}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Nova Senha</Label>
              <Input
                type="password"
                value={novaSenha}
                onChange={e => setNovaSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModalSenha(false)}
              style={{ borderColor: '#2d3148', color: '#8892a4', background: 'transparent' }}
            >
              Cancelar
            </Button>
            <Button
              onClick={salvarSenha}
              disabled={salvandoSenha || novaSenha.length < 6}
              style={{ background: '#4f8ef7', color: 'white' }}
            >
              {salvandoSenha ? 'Salvando...' : 'Redefinir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Deletar */}
      <AlertDialog open={modalDeletar} onOpenChange={setModalDeletar}>
        <AlertDialogContent style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: '#e2e8f0' }}>
              Deletar usuário?
            </AlertDialogTitle>
            <AlertDialogDescription style={{ color: '#8892a4' }}>
              Tem certeza que deseja deletar <strong style={{ color: '#e2e8f0' }}>{usuarioDeletar?.nome}</strong>?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              style={{ background: 'transparent', borderColor: '#2d3148', color: '#8892a4' }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={deletar}
              style={{ background: '#ef4444', color: 'white' }}
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}