import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DicaExtracao } from '@/components/DicaExtracao'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

interface DbStatus {
  familias: { total_skus: number; total_clientes: number; ultima: string | null }
  config:   { total_clientes: number; ultima: string | null }
}

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

  const [dbStatus, setDbStatus]         = useState<DbStatus | null>(null)
  const [carregandoFam, setCarregandoFam] = useState(false)
  const [carregandoCfg, setCarregandoCfg] = useState(false)
  const inputFamRef                     = useRef<HTMLInputElement>(null)
  const inputCfgRef                     = useRef<HTMLInputElement>(null)

  const carregarStatus = async () => {
    try {
      const res = await axios.get(`${API}/api/modulos/fat_arm/status`, { headers: headers() })
      setDbStatus(res.data)
    } catch {
      // silencioso — só não mostra status
    }
  }

  useEffect(() => { carregarStatus() }, [])

  const uploadFamilias = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCarregandoFam(true)
    const form = new FormData()
    form.append('arquivo', file)
    try {
      const res = await axios.post(`${API}/api/modulos/fat_arm/familias`, form, {
        headers: { ...headers(), 'Content-Type': 'multipart/form-data' }
      })
      ;(window as any)._toast?.('sucesso', `DB Famílias: ${res.data.total_skus} SKUs em ${res.data.total_clientes} clientes`)
      await carregarStatus()
    } catch (err: any) {
      ;(window as any)._toast?.('erro', err.response?.data?.erro || 'Erro ao carregar famílias')
    } finally {
      setCarregandoFam(false)
      if (inputFamRef.current) inputFamRef.current.value = ''
    }
  }

  const uploadConfig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCarregandoCfg(true)
    const form = new FormData()
    form.append('arquivo', file)
    try {
      const res = await axios.post(`${API}/api/modulos/fat_arm/config`, form, {
        headers: { ...headers(), 'Content-Type': 'multipart/form-data' }
      })
      ;(window as any)._toast?.('sucesso', `Configuração: ${res.data.total_clientes} clientes com preço`)
      await carregarStatus()
    } catch (err: any) {
      ;(window as any)._toast?.('erro', err.response?.data?.erro || 'Erro ao carregar configuração')
    } finally {
      setCarregandoCfg(false)
      if (inputCfgRef.current) inputCfgRef.current.value = ''
    }
  }

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

  const famOk  = dbStatus && dbStatus.familias.total_skus > 0
  const cfgOk  = dbStatus && dbStatus.config.total_clientes > 0

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: '#e2e8f0' }}>
          🏭 Faturamento Armazenagem
        </h1>
        <p className="text-xs mt-2" style={{ color: '#8892a4', letterSpacing: '0.02em' }}>
          Pico m³ por cliente · SKUs na data do pico
        </p>
      </div>

      {/* ── Banco de Dados ── */}
      <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
        <CardHeader>
          <CardTitle className="text-base" style={{ color: '#e2e8f0' }}>
            Banco de Dados
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs" style={{ color: '#8892a4' }}>
            Carregue os dois bancos de dados antes de gerar o relatório. Eles ficam salvos no servidor — não é necessário recarregar a cada uso.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* DB Famílias */}
            <div className="rounded-md border p-4 space-y-3" style={{ borderColor: famOk ? '#10b981' : '#ef4444', background: '#0f1117' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>📦 DB de Famílias</p>
                {dbStatus ? (
                  famOk ? (
                    <p className="text-xs mt-1" style={{ color: '#10b981' }}>
                      ✅ {dbStatus.familias.total_skus} SKUs · {dbStatus.familias.total_clientes} clientes
                      {dbStatus.familias.ultima ? ` · ${dbStatus.familias.ultima}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs mt-1" style={{ color: '#ef4444' }}>⚠️ DB vazio — carregue o arquivo</p>
                  )
                ) : (
                  <p className="text-xs mt-1" style={{ color: '#8892a4' }}>Carregando...</p>
                )}
              </div>
              <div>
                <input
                  ref={inputFamRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={uploadFamilias}
                  className="hidden"
                  id="input-familias"
                />
                <Button
                  size="sm"
                  disabled={carregandoFam}
                  onClick={() => inputFamRef.current?.click()}
                  style={{ background: '#4c1d95', color: 'white', fontSize: '0.75rem' }}
                >
                  {carregandoFam ? '⏳ Carregando...' : '📥 Carregar / Atualizar Famílias'}
                </Button>
              </div>
              <DicaExtracao linhas={[
                '📋 Exportação do cadastro de produtos do ESL (abas por cliente)',
                'ℹ️ Também aceita planilha de correções de família (formato com coluna "Família Sugerida")',
              ]} />
            </div>

            {/* DB Configuração */}
            <div className="rounded-md border p-4 space-y-3" style={{ borderColor: cfgOk ? '#10b981' : '#ef4444', background: '#0f1117' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>💰 Configuração (Preços)</p>
                {dbStatus ? (
                  cfgOk ? (
                    <p className="text-xs mt-1" style={{ color: '#10b981' }}>
                      ✅ {dbStatus.config.total_clientes} clientes com preço
                      {dbStatus.config.ultima ? ` · ${dbStatus.config.ultima}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs mt-1" style={{ color: '#ef4444' }}>⚠️ DB vazio — carregue o arquivo</p>
                  )
                ) : (
                  <p className="text-xs mt-1" style={{ color: '#8892a4' }}>Carregando...</p>
                )}
              </div>
              <div>
                <input
                  ref={inputCfgRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={uploadConfig}
                  className="hidden"
                  id="input-config"
                />
                <Button
                  size="sm"
                  disabled={carregandoCfg}
                  onClick={() => inputCfgRef.current?.click()}
                  style={{ background: '#065f46', color: 'white', fontSize: '0.75rem' }}
                >
                  {carregandoCfg ? '⏳ Carregando...' : '📥 Carregar Configuração'}
                </Button>
              </div>
              <DicaExtracao linhas={[
                '📋 Planilha com abas "Grupo-Familia" e "Valor de armaz."',
                'ℹ️ Define agrupamentos e preço/m³ por cliente',
              ]} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Configuração do relatório ── */}
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
            <DicaExtracao linhas={[
              '📋 No ESL: Estoque → Relatórios → Movimentação de Estoque',
              '⚙️ Ticar a opção Kardex 2, filtrar pelo período de referência.',
              'ℹ️ Mesmo arquivo usado para atualizar o DB do módulo de Estoque — consolidar com 1 aba por depositante.'
            ]} />
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
            <DicaExtracao linhas={[
              '📋 No ESL: Estoque → Relatórios → Movimentação de Estoque',
              '⚙️ Ticar a opção Kardex, filtrar pelo período de referência e família/grupo.',
              'ℹ️ O arquivo deve ter uma aba por cliente/família com o volume m³ diário.'
            ]} />
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
