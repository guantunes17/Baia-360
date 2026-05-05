import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { ModuloLayout, inputStyle, labelStyle, hintStyle } from '@/components/ModuloLayout'
import { DicaExtracao } from '@/components/DicaExtracao'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { ClipboardList, Database, CheckCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

interface DbInfo {
  total_skus: number
  ultima: string | null
  clientes: string[]
}

export function Estoque() {
  const [dbInfo, setDbInfo]       = useState<DbInfo | null>(null)
  const [loadingDb, setLoadingDb] = useState(true)

  const [arquivoCarga, setArquivoCarga] = useState<File | null>(null)
  const [loadingCarga, setLoadingCarga] = useState(false)
  const [logsCarga, setLogsCarga]       = useState<string[]>([])

  const [arquivoMov, setArquivoMov] = useState<File | null>(null)
  const [loadingMov, setLoadingMov] = useState(false)
  const [logsMov, setLogsMov]       = useState<string[]>([])

  const [arquivoPico, setArquivoPico] = useState<File | null>(null)
  const [diasOcioso, setDiasOcioso]   = useState('120')
  const [mesRef, setMesRef]           = useState('')
  const [status, setStatus]           = useState<Status>('idle')
  const [logs, setLogs]               = useState<string[]>([])
  const [erro, setErro]               = useState('')
  const [jobId, setJobId]             = useState('')

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

  const dbOk = dbInfo && dbInfo.total_skus > 0

  const miniLog = (lines: string[]) => lines.length > 0 ? (
    <div style={{
      marginTop: 6, padding: '8px 10px', borderRadius: 6,
      background: 'rgba(8,11,20,0.7)', maxHeight: 80, overflowY: 'auto',
    }}>
      {lines.map((l, i) => (
        <p key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: T.accentBlue, margin: '1px 0' }}>{l}</p>
      ))}
    </div>
  ) : null

  const btnStyle = (col: string, disabled: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: `${col}18`, border: `1px solid ${col}33`,
    color: col, fontSize: 12, fontWeight: 500, opacity: disabled ? 0.6 : 1,
  })

  const dbCard = (
    <div style={{
      ...glass(0.35, 20),
      boxShadow: neoShadow,
      borderRadius: 14,
      borderColor: `${T.accentAmber}20`,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Database size={14} color={T.accentAmber} />
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Banco de Dados Interno de Estoque</span>
        </div>
        {loadingDb
          ? <Loader2 size={13} color={T.textMuted} />
          : dbOk
            ? <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: T.accentGreen }}>
                <CheckCircle size={12} /> {dbInfo!.total_skus.toLocaleString('pt-BR')} SKUs · {dbInfo!.clientes.length} clientes
              </span>
            : <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: T.accentRed }}>
                <AlertCircle size={12} /> DB vazio — faça a Carga Inicial primeiro
              </span>
        }
      </div>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Carga Inicial */}
        <div>
          <label style={labelStyle}>Carga Inicial (.xlsx — abas por cliente)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputCargaRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setArquivoCarga(e.target.files?.[0] || null)}
              style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}
            />
            <button
              onClick={cargaInicial}
              disabled={!arquivoCarga || loadingCarga}
              style={btnStyle(T.accentBlue, !arquivoCarga || loadingCarga)}
            >
              {loadingCarga ? <Loader2 size={12} /> : '📥'} Carregar
            </button>
          </div>
          {miniLog(logsCarga)}
          <DicaExtracao linhas={[
            '📋 No ESL: Estoque → Relatórios → Movimentação de Estoque',
            '⚙️ Ticar a opção Kardex 2, filtrar pelo período de referência.',
            'ℹ️ Extrair 1 relatório por depositante e consolidar em um único arquivo com uma aba por depositante.',
          ]} />
        </div>

        {/* Atualizar com Movimentação */}
        <div>
          <label style={labelStyle}>Atualizar com Movimentação (.xlsx)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputMovRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setArquivoMov(e.target.files?.[0] || null)}
              style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}
            />
            <button
              onClick={atualizarMov}
              disabled={!arquivoMov || loadingMov}
              style={btnStyle(T.accentAmber, !arquivoMov || loadingMov)}
            >
              {loadingMov ? <Loader2 size={12} /> : <RefreshCw size={12} />} Atualizar
            </button>
          </div>
          {miniLog(logsMov)}
          <DicaExtracao linhas={[
            '📋 No ESL: Estoque → Movimentação → Exportar período (.xlsx)',
            'ℹ️ Use o mesmo período do mês de referência do relatório.',
          ]} />
        </div>
      </div>
    </div>
  )

  return (
    <ModuloLayout
      titulo="Estoque"
      subtitulo="Volume ocupado · Produtos ociosos por cliente · Volume ocioso por cliente."
      cor="#f59e0b"
      icon={ClipboardList}
      status={status}
      logs={logs}
      erro={erro}
      podeProcessar={!!arquivoPico && dbOk !== false}
      onProcessar={gerarRelatorio}
      onResetar={resetar}
      onBaixar={baixar}
      configTitulo="Gerar Relatório"
      extras={dbCard}
    >
      <div>
        <label style={labelStyle}>Arquivo de Pico de Estoque (.xlsx)</label>
        <input
          ref={inputPicoRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={e => setArquivoPico(e.target.files?.[0] || null)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        />
        {arquivoPico && <p style={{ fontSize: 11, color: T.accentBlue, marginTop: 4 }}>✓ {arquivoPico.name}</p>}
        <DicaExtracao linhas={[
          '📋 No ESL: Estoque → Relatórios → Pico de Estoque',
          '⚙️ Ticar a opção Analítico Dia, filtrar pelo período de referência.',
          'ℹ️ O arquivo deve ser consolidado com o pico de cada depositante em uma aba.',
        ]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Dias ocioso</label>
          <input
            type="number"
            value={diasOcioso}
            onChange={e => setDiasOcioso(e.target.value)}
            min="1"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Mês de Referência</label>
          <input
            value={mesRef}
            onChange={e => setMesRef(e.target.value)}
            placeholder="ex: 02-2026"
            style={inputStyle}
          />
          <p style={hintStyle}>Formato: MM-AAAA</p>
        </div>
      </div>
    </ModuloLayout>
  )
}
