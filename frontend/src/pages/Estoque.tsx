import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DicaExtracao } from '@/components/DicaExtracao'

const API = 'http://localhost:5000'
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

interface DbInfo {
  total_skus: number
  ultima: string | null
  clientes: string[]
}

export function Estoque() {
  const [dbInfo, setDbInfo]         = useState<DbInfo | null>(null)
  const [loadingDb, setLoadingDb]   = useState(true)

  const [arquivoCarga, setArquivoCarga]   = useState<File | null>(null)
  const [loadingCarga, setLoadingCarga]   = useState(false)
  const [logsCarga, setLogsCarga]         = useState<string[]>([])

  const [arquivoMov, setArquivoMov]     = useState<File | null>(null)
  const [loadingMov, setLoadingMov]     = useState(false)
  const [logsMov, setLogsMov]           = useState<string[]>([])

  const [arquivoPico, setArquivoPico]   = useState<File | null>(null)
  const [diasOcioso, setDiasOcioso]     = useState('120')
  const [mesRef, setMesRef]             = useState('')
  const [status, setStatus]             = useState<Status>('idle')
  const [logs, setLogs]                 = useState<string[]>([])
  const [erro, setErro]                 = useState('')
  const [jobId, setJobId]               = useState('')

  const inputCargaRef = useRef<HTMLInputElement>(null)
  const inputMovRef   = useRef<HTMLInputElement>(null)
  const inputPicoRef  = useRef<HTMLInputElement>(null)
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const carregarDbInfo = async () => {
    try {
      setLoadingDb(true)
      const res = await axios.get(`${API}/api/modulos/estoque/db/info`, { headers: headers() })
      setDbInfo(res.data)
    } catch {
      setDbInfo(null)
    } finally {
      setLoadingDb(false)
    }
  }

  useEffect(() => { carregarDbInfo() }, [])

  const cargaInicial = async () => {
    if (!arquivoCarga) return
    setLoadingCarga(true)
    setLogsCarga([])
    const formData = new FormData()
    formData.append('arquivo', arquivoCarga)
    try {
      const res = await axios.post(`${API}/api/modulos/estoque/db/carga`, formData, {
        headers: { ...headers(), 'Content-Type': 'multipart/form-data' }
      })
      setLogsCarga(res.data.logs || [res.data.msg])
      carregarDbInfo()
      setArquivoCarga(null)
      if (inputCargaRef.current) inputCargaRef.current.value = ''
    } catch (err: any) {
      setLogsCarga([err.response?.data?.erro || 'Erro na carga'])
    } finally {
      setLoadingCarga(false)
    }
  }

  const atualizarMov = async () => {
    if (!arquivoMov) return
    setLoadingMov(true)
    setLogsMov([])
    const formData = new FormData()
    formData.append('arquivo', arquivoMov)
    try {
      const res = await axios.post(`${API}/api/modulos/estoque/db/atualizar`, formData, {
        headers: { ...headers(), 'Content-Type': 'multipart/form-data' }
      })
      setLogsMov(res.data.logs || [res.data.msg])
      carregarDbInfo()
      setArquivoMov(null)
      if (inputMovRef.current) inputMovRef.current.value = ''
    } catch (err: any) {
      setLogsMov([err.response?.data?.erro || 'Erro na atualização'])
    } finally {
      setLoadingMov(false)
    }
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

  const gerarRelatorio = async () => {
    if (!arquivoPico) return
    setStatus('processando')
    setLogs([])
    setErro('')
    const formData = new FormData()
    formData.append('arquivo_pico', arquivoPico)
    formData.append('dias_ocioso', diasOcioso)
    formData.append('mes_ref', mesRef.trim())
    try {
      const res = await axios.post(`${API}/api/modulos/estoque/gerar`, formData, {
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

  const resetar = () => {
    setStatus('idle')
    setLogs([])
    setErro('')
    setJobId('')
    setArquivoPico(null)
    if (inputPicoRef.current) inputPicoRef.current.value = ''
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>📋 Estoque</h1>
        <p className="text-sm mt-1" style={{ color: '#8892a4' }}>
          Volume ocupado · Produtos ociosos por cliente
        </p>
      </div>

      {/* Status do DB */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader>
          <CardTitle className="text-base" style={{ color: '#e2e8f0' }}>
            🗄️ Banco de Dados Interno de Estoque
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingDb ? (
            <p className="text-sm" style={{ color: '#8892a4' }}>Carregando...</p>
          ) : dbInfo && dbInfo.total_skus > 0 ? (
            <div className="flex flex-wrap gap-2 items-center mb-4">
              <Badge variant="outline" style={{ borderColor: '#10b981', color: '#10b981' }}>
                ✅ {dbInfo.total_skus.toLocaleString('pt-BR')} SKUs
              </Badge>
              <Badge variant="outline" style={{ borderColor: '#4f8ef7', color: '#4f8ef7' }}>
                {dbInfo.clientes.length} clientes
              </Badge>
              {dbInfo.ultima && (
                <Badge variant="outline" style={{ borderColor: '#2d3148', color: '#8892a4' }}>
                  Última atualização: {dbInfo.ultima}
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-sm mb-4" style={{ color: '#ef4444' }}>
              ⚠️ Banco de dados vazio — faça a Carga Inicial primeiro.
            </p>
          )}

          {/* Carga Inicial */}
          <div className="space-y-2 mb-4">
            <Label style={{ color: '#8892a4' }}>Carga Inicial (.xlsx — abas por cliente)</Label>
            <div className="flex gap-2">
              <input
                ref={inputCargaRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setArquivoCarga(e.target.files?.[0] || null)}
                className="flex-1 text-sm rounded-md border px-3 py-2 cursor-pointer"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
              <Button
                onClick={cargaInicial}
                disabled={!arquivoCarga || loadingCarga}
                style={{ background: '#4f8ef7', color: 'white' }}
              >
                {loadingCarga ? '⏳' : '📥 Carregar'}
              </Button>
            </div>
            {logsCarga.length > 0 && (
              <div className="rounded p-2 text-xs font-mono max-h-24 overflow-y-auto"
                style={{ background: '#0f1117', color: '#4f8ef7' }}>
                {logsCarga.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            )}
            <DicaExtracao linhas={[
              '📋 No ESL: Estoque → Relatórios → Movimentação de Estoque',
              '⚙️ Ticar a opção Kardex 2, filtrar pelo período de referência.',
              'ℹ️ Extrair 1 relatório por depositante e consolidar em um único arquivo com uma aba por depositante.',
            ]} />
          </div>

          {/* Atualizar com Movimentação */}
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Atualizar com Movimentação (.xlsx)</Label>
            <div className="flex gap-2">
              <input
                ref={inputMovRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setArquivoMov(e.target.files?.[0] || null)}
                className="flex-1 text-sm rounded-md border px-3 py-2 cursor-pointer"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
              <Button
                onClick={atualizarMov}
                disabled={!arquivoMov || loadingMov}
                style={{ background: '#f59e0b', color: 'white' }}
              >
                {loadingMov ? '⏳' : '🔄 Atualizar'}
              </Button>
            </div>
            {logsMov.length > 0 && (
              <div className="rounded p-2 text-xs font-mono max-h-24 overflow-y-auto"
                style={{ background: '#0f1117', color: '#4f8ef7' }}>
                {logsMov.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            )}
            <DicaExtracao linhas={[
              '📋 No ESL: Estoque → Movimentação → Exportar período (.xlsx)',
              'ℹ️ Use o mesmo período do mês de referência do relatório.',
            ]} />
          </div>
        </CardContent>
      </Card>

      {/* Gerar Relatório */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader>
          <CardTitle className="text-base" style={{ color: '#e2e8f0' }}>
            Gerar Relatório
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label style={{ color: '#8892a4' }}>Arquivo de Pico de Estoque (.xlsx)</Label>
            <input
              ref={inputPicoRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setArquivoPico(e.target.files?.[0] || null)}
              className="w-full text-sm rounded-md border px-3 py-2 cursor-pointer"
              style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
            />
            {arquivoPico && (
              <p className="text-xs" style={{ color: '#4f8ef7' }}>✓ {arquivoPico.name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Dias ocioso</Label>
              <Input
                type="number"
                value={diasOcioso}
                onChange={e => setDiasOcioso(e.target.value)}
                min="1"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
            </div>
            <div className="space-y-2">
              <Label style={{ color: '#8892a4' }}>Mês de Referência</Label>
              <Input
                value={mesRef}
                onChange={e => setMesRef(e.target.value)}
                placeholder="ex: 02-2026"
                style={{ background: '#0f1117', borderColor: '#2d3148', color: '#e2e8f0' }}
              />
            </div>
          </div>

          <DicaExtracao linhas={[
            '📋 No ESL: Estoque → Relatórios → Pico de Estoque',
            '⚙️ Ticar a opção Analítico Dia, filtrar pelo período de referência.',
            'ℹ️ O arquivo deve ser consolidado com o pico de cada depositante em uma aba.',
          ]} />
        </CardContent>
      </Card>

      {/* Botões */}
      <div className="flex gap-3 mb-6">
        <Button
          onClick={gerarRelatorio}
          disabled={!arquivoPico || status === 'processando' || (dbInfo?.total_skus === 0)}
          style={{ background: '#f59e0b', color: 'white' }}
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
              ✅ Relatório gerado com sucesso! Clique em "Baixar Relatório" para fazer o download.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}