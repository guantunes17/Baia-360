import { useState, useRef } from 'react'
import axios from 'axios'
import { ModuloLayout, inputStyle, labelStyle, hintStyle } from '@/components/ModuloLayout'
import { DicaExtracao } from '@/components/DicaExtracao'
import { T } from '@/lib/theme'
import { Activity } from 'lucide-react'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

export function CapOperacional() {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [mesRef, setMesRef]   = useState('')
  const [status, setStatus]   = useState<Status>('idle')
  const [logs, setLogs]       = useState<string[]>([])
  const [erro, setErro]       = useState('')
  const [jobId, setJobId]     = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)
  const intervalRef           = useRef<ReturnType<typeof setInterval> | null>(null)
  const [limiarMedia, setLimiarMedia] = useState('3')
  const [limiarAlta, setLimiarAlta]   = useState('5')

  const resetar = () => {
    setArquivo(null)
    setMesRef('')
    setStatus('idle')
    setLogs([])
    setErro('')
    setJobId('')
    if (inputRef.current) inputRef.current.value = ''
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
    if (!arquivo || !mesRef.trim()) return
    setStatus('processando')
    setLogs([])
    setErro('')

    const formData = new FormData()
    formData.append('arquivo', arquivo)
    formData.append('mes_ref', mesRef.trim())
    formData.append('limiar_media', limiarMedia)
    formData.append('limiar_alta', limiarAlta)

    try {
      const res = await axios.post(`${API}/api/modulos/cap_operacional`, formData, {
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
    <ModuloLayout
      titulo="Capacidade Operacional"
      subtitulo="OS por depositante · SKUs · Extração do ESL"
      cor="#e11d48"
      icon={Activity}
      status={status}
      logs={logs}
      erro={erro}
      podeProcessar={!!arquivo && !!mesRef.trim()}
      onProcessar={processar}
      onResetar={resetar}
      onBaixar={baixar}
    >
      <div>
        <label style={labelStyle}>Arquivo PDF do ESL</label>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          onChange={e => setArquivo(e.target.files?.[0] || null)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        />
        {arquivo && <p style={{ fontSize: 11, color: T.accentBlue, marginTop: 4 }}>✓ {arquivo.name}</p>}
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Limiar Média (SKUs/OS)</label>
          <input
            type="number"
            value={limiarMedia}
            onChange={e => setLimiarMedia(e.target.value)}
            min="1"
            step="0.5"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Limiar Alta (SKUs/OS)</label>
          <input
            type="number"
            value={limiarAlta}
            onChange={e => setLimiarAlta(e.target.value)}
            min="1"
            step="0.5"
            style={inputStyle}
          />
        </div>
      </div>
      <p style={hintStyle}>
        Baixa &lt; {limiarMedia} SKUs/OS | Média {limiarMedia}–{limiarAlta} | Alta ≥ {limiarAlta}
      </p>

      <DicaExtracao linhas={[
        '📋 No ESL: Estoque → Relatórios → Movimentação de Estoque',
        '⚙️ Ticar a opção Kardex, filtrar pelo período de referência.',
        'ℹ️ O arquivo deve conter as colunas de OS, SKU e depositante.',
      ]} />
    </ModuloLayout>
  )
}
