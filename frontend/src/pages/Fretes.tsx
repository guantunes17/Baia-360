import { useState, useRef } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DicaExtracao } from '@/components/DicaExtracao'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

export function Fretes() {
  const [arquivo, setArquivo]     = useState<File | null>(null)
  const [nomeAba, setNomeAba]     = useState('')
  const [status, setStatus]       = useState<Status>('idle')
  const [logs, setLogs]           = useState<string[]>([])
  const [erro, setErro]           = useState('')
  const [jobId, setJobId]         = useState('')
  const inputRef                  = useRef<HTMLInputElement>(null)
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null)

  const resetar = () => {
    setArquivo(null)
    setNomeAba('')
    setStatus('idle')
    setLogs([])
    setErro('')
    setJobId('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const iniciarPolling = (id: string) => {
    intervalRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`${API}/api/modulos/status/${id}`, {
          headers: headers()
        })
        const job = res.data

        setLogs(job.logs || [])

        if (job.status === 'concluido') {
          clearInterval(intervalRef.current!)
          setStatus('concluido')
          ;(window as any)._toast?.('sucesso', 'Relatório gerado com sucesso!')
        } else if (job.status === 'erro') {
          clearInterval(intervalRef.current!)
          setStatus('erro')
          setErro(job.erro || 'Erro desconhecido')
          ;(window as any)._toast?.('erro', job.erro || 'Erro ao gerar relatório')
        }
      } catch {
        clearInterval(intervalRef.current!)
        setStatus('erro')
        setErro('Erro ao verificar status')
      }
    }, 1000)
  }

  const processar = async () => {
    if (!arquivo || !nomeAba.trim()) return

    setStatus('processando')
    setLogs([])
    setErro('')

    const formData = new FormData()
    formData.append('arquivo', arquivo)
    formData.append('nome_aba', nomeAba.trim())

    try {
      const res = await axios.post(`${API}/api/modulos/fretes`, formData, {
        headers: { ...headers(), 'Content-Type': 'multipart/form-data' }
      })
      setJobId(res.data.job_id)
      iniciarPolling(res.data.job_id)
    } catch (err: any) {
      setStatus('erro')
      setErro(err.response?.data?.erro || 'Erro ao iniciar processamento')
    }
  }

  const baixar = () => {
    window.open(`${API}/api/modulos/download/${jobId}?token=${localStorage.getItem('token')}`, '_blank')
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Cabeçalho */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: '#e2e8f0' }}>
          🚚 Fretes
        </h1>
        <p className="text-xs mt-2" style={{ color: '#8892a4', letterSpacing: '0.02em' }}>
          Embarques · RESCOM · Portadores · Custo de Insumos
        </p>
      </div>

      {/* Card de configuração */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader>
          <CardTitle className="text-base" style={{ color: '#e2e8f0' }}>
            Configuração
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

  {/* Upload */}
  <div className="space-y-2">
    <Label style={{ color: '#8892a4' }}>Arquivo de Fretes (.xlsx)</Label>
    <input
      ref={inputRef}
      type="file"
      accept=".xlsx,.xls"
      onChange={e => setArquivo(e.target.files?.[0] || null)}
      className="w-full text-sm rounded-md border px-3 py-2 cursor-pointer"
      style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
    />
    {arquivo && (
      <p className="text-xs" style={{ color: '#4f8ef7' }}>✓ {arquivo.name}</p>
    )}
  </div>

  {/* Nome da aba */}
<div className="space-y-2">
  <Label style={{ color: '#8892a4' }}>Nome da aba de Embarques</Label>
  <Input
    value={nomeAba}
    onChange={e => setNomeAba(e.target.value)}
    placeholder="ex: EMBARQUES 02.26"
    style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
  />
  <DicaExtracao linhas={[
    '📋 No ESL: Transportes → Emissão de Fretes',
    'ℹ️ Exportar a planilha inteira filtrada pelo mês de referência.',
    '📋 Nome da aba: geralmente EMBARQUES MM.AA (ex: EMBARQUES 02.26)',
  ]} />
  </div>

</CardContent>
      </Card>

      {/* Botões */}
      <div className="flex gap-3 mb-6">
        <Button
          onClick={processar}
          disabled={!arquivo || !nomeAba.trim() || status === 'processando'}
          style={{ background: '#7c3aed', color: 'white' }}
        >
          {status === 'processando' ? '⏳ Processando...' : '▶ Gerar Relatório'}
        </Button>

        {status !== 'idle' && (
          <Button
            variant="outline"
            onClick={resetar}
            style={{ borderColor: '#2d3148', color: '#8892a4', background: 'transparent' }}
          >
            Limpar
          </Button>
        )}

        {status === 'concluido' && (
          <Button
            onClick={baixar}
            style={{ background: '#10b981', color: 'white' }}
          >
            ⬇ Baixar Relatório
          </Button>
        )}
      </div>

      {/* Log */}
      {logs.length > 0 && (
        <Card className="border" style={{ background: '#0f1117', borderColor: '#2d3148' }}>
          <CardContent className="p-4">
            <p className="text-xs font-semibold mb-2" style={{ color: '#8892a4' }}>
              LOG DE PROCESSAMENTO
            </p>
            <div className="space-y-0 max-h-64 overflow-y-auto">
              {logs.map((linha, i) => (
                <p key={i} className="text-xs font-mono" style={{ color: '#4f8ef7' }}>
                  {linha}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Erro */}
      {erro && (
        <Card className="border mt-4" style={{ background: '#1a1d27', borderColor: '#ef4444' }}>
          <CardContent className="p-4">
            <p className="text-sm" style={{ color: '#ef4444' }}>❌ {erro}</p>
          </CardContent>
        </Card>
      )}

      {/* Sucesso */}
      {status === 'concluido' && (
        <Card className="border mt-4" style={{ background: '#1a1d27', borderColor: '#10b981' }}>
          <CardContent className="p-4">
            <p className="text-sm" style={{ color: '#10b981' }}>
              ✅ Relatório gerado com sucesso! Clique em "Baixar Relatório" para fazer o download.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}