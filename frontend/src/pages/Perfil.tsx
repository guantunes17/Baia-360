import { useState } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { API } from '../config'

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

      {erro    && <p className="text-sm mb-4" style={{ color: '#ef4444' }}>{erro}</p>}
      {sucesso && <p className="text-sm mb-4" style={{ color: '#10b981' }}>{sucesso}</p>}

      <Button onClick={salvar} disabled={salvando} style={{ background: '#4f8ef7', color: 'white' }}>
        {salvando ? 'Salvando...' : 'Salvar alterações'}
      </Button>
    </div>
  )
}