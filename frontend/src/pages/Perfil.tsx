import { useState } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const API = 'http://localhost:5001'
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

export function Perfil({ usuario, onAtualizar }: Props) {
  const [nome, setNome]               = useState(usuario.nome)
  const [senhaAtual, setSenhaAtual]   = useState('')
  const [novaSenha, setNovaSenha]     = useState('')
  const [confirmar, setConfirmar]     = useState('')
  const [salvando, setSalvando]       = useState(false)
  const [sucesso, setSucesso]         = useState('')
  const [erro, setErro]               = useState('')

  const salvar = async () => {
    setErro('')
    setSucesso('')

    if (novaSenha && novaSenha !== confirmar) {
      setErro('As senhas não coincidem.')
      return
    }
    if (novaSenha && !senhaAtual) {
      setErro('Informe a senha atual para trocar a senha.')
      return
    }

    setSalvando(true)
    try {
      const payload: any = { nome }
      if (novaSenha) {
        payload.senha_atual = senhaAtual
        payload.nova_senha  = novaSenha
      }

      const res = await axios.put(`${API}/api/auth/perfil`, payload, { headers: headers() })
      localStorage.setItem('usuario', JSON.stringify(res.data))
      onAtualizar(res.data)
      setSucesso('Perfil atualizado com sucesso!')
      setSenhaAtual('')
      setNovaSenha('')
      setConfirmar('')
    } catch (err: any) {
      setErro(err.response?.data?.erro || 'Erro ao salvar perfil')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="p-8 max-w-xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>👤 Meu Perfil</h1>
        <p className="text-sm mt-1" style={{ color: '#8892a4' }}>
          Gerencie suas informações pessoais e senha de acesso.
        </p>
      </div>

      {/* Dados pessoais */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader>
          <CardTitle className="text-base" style={{ color: '#e2e8f0' }}>Dados Pessoais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Nome</Label>
            <Input
              value={nome}
              onChange={e => setNome(e.target.value)}
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
          </div>
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Email</Label>
            <Input
              value={usuario.email}
              disabled
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#8892a4' }}
            />
            <p className="text-xs" style={{ color: '#8892a4' }}>O email não pode ser alterado.</p>
          </div>
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Perfil</Label>
            <Input
              value={usuario.perfil === 'admin' ? 'Administrador' : 'Usuário'}
              disabled
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#8892a4' }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Trocar senha */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader>
          <CardTitle className="text-base" style={{ color: '#e2e8f0' }}>Trocar Senha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Senha Atual</Label>
            <Input
              type="password"
              value={senhaAtual}
              onChange={e => setSenhaAtual(e.target.value)}
              placeholder="••••••••"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
          </div>
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Nova Senha</Label>
            <Input
              type="password"
              value={novaSenha}
              onChange={e => setNovaSenha(e.target.value)}
              placeholder="••••••••"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
          </div>
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Confirmar Nova Senha</Label>
            <Input
              type="password"
              value={confirmar}
              onChange={e => setConfirmar(e.target.value)}
              placeholder="••••••••"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
          </div>
          <p className="text-xs" style={{ color: '#8892a4' }}>
            ℹ️ Deixe em branco para não alterar a senha.
          </p>
        </CardContent>
      </Card>

      {erro && <p className="text-sm mb-4" style={{ color: '#ef4444' }}>❌ {erro}</p>}
      {sucesso && <p className="text-sm mb-4" style={{ color: '#10b981' }}>✅ {sucesso}</p>}

      <Button
        onClick={salvar}
        disabled={salvando}
        style={{ background: '#4f8ef7', color: 'white' }}
      >
        {salvando ? 'Salvando...' : '💾 Salvar Alterações'}
      </Button>
    </div>
  )
}