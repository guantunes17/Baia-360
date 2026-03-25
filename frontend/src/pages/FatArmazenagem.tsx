import { useState, useRef } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const API = 'http://localhost:5000'
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

export function FatArmazenagem() {
  const [arquivoMov, setArquivoMov]     = useState<File | null>(null)
  const [arquivoVol, setArquivoVol]     = useState<File | null>(null)
  const [mesRef, setMesRef]             = useState('')
  const [status, setStatus]             = useState<Status>('idle')
  const [logs, setLogs]                 = useState<string[]>([])
  const [erro, setErro]                 = useState('')
  const [jobId, setJobId]               = useState('')
  const inputMovRef                     = useRef<HTMLInputElement>(null)
  const inputVolRef                     = useRef<HTMLInputElement>(null)
  const intervalRef                     = useRef<ReturnType<typeof setInterval> | null>(null)

  const resetar = () => {
    setArquivoMov(null)
    setArquivoVol(null)
    setMesRef('')
    setStatus('idle')
    setLogs([])
    setErro('')
    setJobId('')
    if (inputMovRef.current) inputMovRef.current.value = ''
    if (inputVolRef.current) inputVolRef.current.value = ''
  }

  const iniciarPolling = (id: string) => {
    intervalRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`${API}/api/modulos/status/${id}`, { headers: headers() })
        const job = res.data
        setLogs(job.logs || [])
        if (job.status === 'concluido') {
          clearInterval(intervalRef.current!)
          setStatus('concluido')
        } else if (job.status === 'erro') {
          clearInterval(intervalRef.current!)
          setStatus('erro')
          setErro(job.erro || 'Erro desconhecido')
        }
      } catch {
        clearInterval(intervalRef.current!)
        setStatus('erro')
        setErro('Erro ao verificar status')
      }
    }, 1000)
  }

  const processar = async () => {
    if (!arquivoMov || !arquivoVol || !mesRef.trim()) return
    setStatus('processando')
    setLogs([])
    setErro('')

    const formData = new FormData()
    formData.append('arquivo_mov', arquivoMov)
    formData.append('arquivo_volumes', arquivoVol)
    formData.append('mes_ref', mesRef.trim())

    try {
      const res = await axios.post(`${API}/api/modulos/fat_arm`, formData, {
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>
          🏭 Faturamento Armazenagem
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8892a4' }}>
          Pico m³ por cliente · SKUs na data do pico
        </p>
      </div>

      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader>
          <CardTitle className="text-base" style={{ color: '#e2e8f0' }}>
            Configuração
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Arquivo de Movimentação (.xlsx)</Label>
            <input
              ref={inputMovRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setArquivoMov(e.target.files?.[0] || null)}
              className="w-full text-sm rounded-md border px-3 py-2 cursor-pointer"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
            {arquivoMov && (
              <p className="text-xs" style={{ color: '#4f8ef7' }}>✓ {arquivoMov.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Arquivo de Volumes (.xlsx)</Label>
            <input
              ref={inputVolRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setArquivoVol(e.target.files?.[0] || null)}
              className="w-full text-sm rounded-md border px-3 py-2 cursor-pointer"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
            {arquivoVol && (
              <p className="text-xs" style={{ color: '#4f8ef7' }}>✓ {arquivoVol.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Mês de Referência</Label>
            <Input
              value={mesRef}
              onChange={e => setMesRef(e.target.value)}
              placeholder="ex: 02-2026"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
            <p className="text-xs" style={{ color: '#8892a4' }}>
              ℹ️ Formato: MM-AAAA (ex: 02-2026)
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 mb-6">
        <Button
          onClick={processar}
          disabled={!arquivoMov || !arquivoVol || !mesRef.trim() || status === 'processando'}
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
          <Button onClick={baixar} style={{ background: '#10b981', color: 'white' }}>
            ⬇ Baixar Relatório
          </Button>
        )}
      </div>

      {logs.length > 0 && (
        <Card className="border" style={{ background: '#0f1117', borderColor: '#2d3148' }}>
          <CardContent className="p-4">
            <p className="text-xs font-semibold mb-2" style={{ color: '#8892a4' }}>
              LOG DE PROCESSAMENTO
            </p>
            <div className="space-y-0 max-h-64 overflow-y-auto">
              {logs.map((linha, i) => (
                <p key={i} className="text-xs font-mono" style={{ color: '#4f8ef7' }}>{linha}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {erro && (
        <Card className="border mt-4" style={{ background: '#1a1d27', borderColor: '#ef4444' }}>
          <CardContent className="p-4">
            <p className="text-sm" style={{ color: '#ef4444' }}>❌ {erro}</p>
          </CardContent>
        </Card>
      )}

      {status === 'concluido' && (
        <Card className="border mt-4" style={{ background: '#1a1d27', borderColor: '#10b981' }}>
          <CardContent className="p-4">
            <p className="text-sm" style={{ color: '#10b981' }}>
              ✅ Relatório gerado! Clique em "Baixar Relatório" para fazer o download.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}