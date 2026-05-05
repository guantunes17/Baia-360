import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { ModuloLayout, inputStyle, labelStyle, hintStyle } from '@/components/ModuloLayout'
import { DicaExtracao } from '@/components/DicaExtracao'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { BarChart3, Database, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
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

  const [dbStatus, setDbStatus]           = useState<DbStatus | null>(null)
  const [carregandoFam, setCarregandoFam] = useState(false)
  const [carregandoCfg, setCarregandoCfg] = useState(false)
  const [erroFam, setErroFam]             = useState('')
  const [erroCfg, setErroCfg]             = useState('')
  const inputFamRef                       = useRef<HTMLInputElement>(null)
  const inputCfgRef                       = useRef<HTMLInputElement>(null)

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
    setErroFam('')
    const form = new FormData()
    form.append('arquivo', file)
    try {
      const res = await axios.post(`${API}/api/modulos/fat_arm/familias`, form, {
        headers: { ...headers(), 'Content-Type': 'multipart/form-data' }
      })
      ;(window as any)._toast?.('sucesso', `DB Famílias: ${res.data.total_skus} SKUs em ${res.data.total_clientes} clientes`)
      await carregarStatus()
    } catch (err: any) {
      const msg = err.response?.data?.erro || 'Erro ao carregar famílias'
      setErroFam(msg)
      ;(window as any)._toast?.('erro', msg)
    } finally {
      setCarregandoFam(false)
      if (inputFamRef.current) inputFamRef.current.value = ''
    }
  }

  const uploadConfig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCarregandoCfg(true)
    setErroCfg('')
    const form = new FormData()
    form.append('arquivo', file)
    try {
      const res = await axios.post(`${API}/api/modulos/fat_arm/config`, form, {
        headers: { ...headers(), 'Content-Type': 'multipart/form-data' }
      })
      ;(window as any)._toast?.('sucesso', `Configuração: ${res.data.total_clientes} clientes com preço`)
      await carregarStatus()
    } catch (err: any) {
      const msg = err.response?.data?.erro || 'Erro ao carregar configuração'
      setErroCfg(msg)
      ;(window as any)._toast?.('erro', msg)
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

  const famOk = dbStatus && dbStatus.familias.total_skus > 0
  const cfgOk = dbStatus && dbStatus.config.total_clientes > 0

  const dbCard = (
    <div style={{
      ...glass(0.35, 20),
      boxShadow: neoShadow,
      borderRadius: 14,
      borderColor: `${T.accentPurple}20`,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Database size={14} color={T.accentPurple} />
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Banco de Dados</span>
      </div>
      <div style={{ padding: 20 }}>
        <p style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>
          Carregue os dois bancos antes de gerar o relatório. Ficam salvos no servidor — não é necessário recarregar a cada uso.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* DB Famílias */}
          <div style={{
            ...glass(0.25, 12),
            borderColor: famOk ? `${T.accentGreen}44` : `${T.accentRed}33`,
            borderRadius: 10, padding: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {famOk
                ? <CheckCircle size={13} color={T.accentGreen} />
                : <AlertCircle size={13} color={T.accentRed} />
              }
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>DB de Famílias</span>
            </div>
            {dbStatus ? (
              famOk ? (
                <p style={{ fontSize: 11, color: T.accentGreen }}>
                  {dbStatus.familias.total_skus} SKUs · {dbStatus.familias.total_clientes} clientes
                  {dbStatus.familias.ultima ? ` · ${dbStatus.familias.ultima}` : ''}
                </p>
              ) : (
                <p style={{ fontSize: 11, color: T.accentRed }}>DB vazio — carregue o arquivo</p>
              )
            ) : (
              <p style={{ fontSize: 11, color: T.textMuted }}>Carregando...</p>
            )}
            <input ref={inputFamRef} type="file" accept=".xlsx,.xls" onChange={uploadFamilias} style={{ display: 'none' }} />
            <button
              disabled={carregandoFam}
              onClick={() => inputFamRef.current?.click()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 6, cursor: carregandoFam ? 'not-allowed' : 'pointer',
                background: `${T.accentPurple}20`, border: `1px solid ${T.accentPurple}40`,
                color: T.accentPurple, fontSize: 12, fontWeight: 500,
                opacity: carregandoFam ? 0.6 : 1,
              }}
            >
              {carregandoFam ? <><Loader2 size={12} /> Carregando...</> : '📥 Carregar / Atualizar Famílias'}
            </button>
            {erroFam && <p style={{ fontSize: 11, color: T.accentRed }}>❌ {erroFam}</p>}
            <DicaExtracao linhas={[
              '📋 Exportação do cadastro de produtos do ESL (abas por cliente)',
              'ℹ️ Também aceita planilha de correções de família',
            ]} />
          </div>

          {/* DB Configuração */}
          <div style={{
            ...glass(0.25, 12),
            borderColor: cfgOk ? `${T.accentGreen}44` : `${T.accentRed}33`,
            borderRadius: 10, padding: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {cfgOk
                ? <CheckCircle size={13} color={T.accentGreen} />
                : <AlertCircle size={13} color={T.accentRed} />
              }
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Configuração (Preços)</span>
            </div>
            {dbStatus ? (
              cfgOk ? (
                <p style={{ fontSize: 11, color: T.accentGreen }}>
                  {dbStatus.config.total_clientes} clientes com preço
                  {dbStatus.config.ultima ? ` · ${dbStatus.config.ultima}` : ''}
                </p>
              ) : (
                <p style={{ fontSize: 11, color: T.accentRed }}>DB vazio — carregue o arquivo</p>
              )
            ) : (
              <p style={{ fontSize: 11, color: T.textMuted }}>Carregando...</p>
            )}
            <input ref={inputCfgRef} type="file" accept=".xlsx,.xls" onChange={uploadConfig} style={{ display: 'none' }} />
            <button
              disabled={carregandoCfg}
              onClick={() => inputCfgRef.current?.click()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 6, cursor: carregandoCfg ? 'not-allowed' : 'pointer',
                background: `${T.accentGreen}14`, border: `1px solid ${T.accentGreen}33`,
                color: T.accentGreen, fontSize: 12, fontWeight: 500,
                opacity: carregandoCfg ? 0.6 : 1,
              }}
            >
              {carregandoCfg ? <><Loader2 size={12} /> Carregando...</> : '📥 Carregar Configuração'}
            </button>
            {erroCfg && <p style={{ fontSize: 11, color: T.accentRed }}>❌ {erroCfg}</p>}
            <DicaExtracao linhas={[
              '📋 Planilha com abas "Grupo-Familia" e "Valor de armaz."',
              'ℹ️ Define agrupamentos e preço/m³ por cliente',
            ]} />
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <ModuloLayout
      titulo="Faturamento Armazenagem"
      subtitulo="Pico m³ por cliente · SKUs na data do pico"
      cor="#7c3aed"
      icon={BarChart3}
      status={status}
      logs={logs}
      erro={erro}
      podeProcessar={!!arquivoMov && !!arquivoVol && !!mesRef.trim()}
      onProcessar={processar}
      onResetar={resetar}
      onBaixar={baixar}
      extras={dbCard}
    >
      <div>
        <label style={labelStyle}>Arquivo de Movimentação (.xlsx)</label>
        <input
          ref={inputMovRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={e => setArquivoMov(e.target.files?.[0] || null)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        />
        {arquivoMov && <p style={{ fontSize: 11, color: T.accentBlue, marginTop: 4 }}>✓ {arquivoMov.name}</p>}
        <DicaExtracao linhas={[
          '📋 No ESL: Estoque → Relatórios → Movimentação de Estoque',
          '⚙️ Ticar a opção Kardex 2, filtrar pelo período de referência.',
          'ℹ️ Consolidar com 1 aba por depositante.',
        ]} />
      </div>

      <div>
        <label style={labelStyle}>Arquivo de Volumes (.xlsx)</label>
        <input
          ref={inputVolRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={e => setArquivoVol(e.target.files?.[0] || null)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        />
        {arquivoVol && <p style={{ fontSize: 11, color: T.accentBlue, marginTop: 4 }}>✓ {arquivoVol.name}</p>}
        <DicaExtracao linhas={[
          '📋 No ESL: Estoque → Relatórios → Movimentação de Estoque',
          '⚙️ Ticar a opção Kardex, filtrar pelo período e família/grupo.',
          'ℹ️ Uma aba por cliente/família com o volume m³ diário.',
        ]} />
      </div>

      <div>
        <label style={labelStyle}>Mês de Referência</label>
        <input
          value={mesRef}
          onChange={e => setMesRef(e.target.value)}
          placeholder="ex: 02-2026"
          style={inputStyle}
        />
        <p style={hintStyle}>Formato: MM-AAAA (ex: 02-2026)</p>
      </div>
    </ModuloLayout>
  )
}
