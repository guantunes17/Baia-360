import { useState, useRef } from 'react'
import axios from 'axios'
import { ModuloLayout, inputStyle, labelStyle, hintStyle } from '@/components/ModuloLayout'
import { DicaExtracao } from '@/components/DicaExtracao'
import { T } from '@/lib/theme'
import { PackageOpen } from 'lucide-react'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

export function Recebimentos() {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [mesRef, setMesRef]   = useState('')
  const [status, setStatus]   = useState<Status>('idle')
  const [logs, setLogs]       = useState<string[]>([])
  const [erro, setErro]       = useState('')
  const [jobId, setJobId]     = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)
  const intervalRef           = useRef<ReturnType<typeof setInterval> | null>(null)

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

    try {
      const res = await axios.post(`${API}/api/modulos/recebimentos`, formData, {
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
      titulo="Recebimentos e Devoluções"
      subtitulo="Entradas · Devoluções · Retiradas por depositante"
      cor="#0891b2"
      icon={PackageOpen}
      status={status}
      logs={logs}
      erro={erro}
      podeProcessar={!!arquivo && !!mesRef.trim()}
      onProcessar={processar}
      onResetar={resetar}
      onBaixar={baixar}
    >
      <div>
        <label style={labelStyle}>Arquivo de Recebimentos (.xlsx)</label>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
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
        <p style={hintStyle}>Formato: Mês/Ano (ex: 02-2026)</p>
      </div>

      <DicaExtracao linhas={[
        '📋 No ESL: Estoque → Movimentação → NF de Entrada',
        'ℹ️ Filtrar pelo período de referência e exportar.',
        '⚠️ Ajustes e Manuseios são filtrados automaticamente pelo sistema.',
      ]} />
    </ModuloLayout>
  )
}
