import { useEffect, useState, useRef } from 'react'
import { API } from '../config'

const token = () => localStorage.getItem('token') || ''
const headers = () => ({ Authorization: `Bearer ${token()}` })

interface Documento {
  file_id: string
  nome: string
  tamanho: number
  status: string
  criado_em: number
}

function formatarTamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatarData(ts: number) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('pt-BR')
}

function estimarCusto(docs: Documento[]) {
  const totalBytes = docs.reduce((s, d) => s + d.tamanho, 0)
  const gb = totalBytes / (1024 * 1024 * 1024)
  const custoMes = gb * 0.10 * 30
  return custoMes < 0.01 ? '< $0,01' : `~$${custoMes.toFixed(2)}`
}

export function BaseConhecimento() {
  const [docs, setDocs] = useState<Documento[]>([])
  const [vsId, setVsId] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploadando, setUploadando] = useState(false)
  const [deletandoId, setDeletandoId] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const carregar = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API}/api/atlas/base_conhecimento`, { headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro)
      setDocs(data.documentos || [])
      setVsId(data.vector_store_id || '')
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadando(true)
    setErro('')
    setSucesso('')
    try {
      const form = new FormData()
      form.append('arquivo', file)
      const res = await fetch(`${API}/api/atlas/base_conhecimento`, {
        method: 'POST',
        headers: headers(),
        body: form
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro)
      setSucesso(`"${data.nome}" enviado e sendo indexado. Pode levar alguns segundos.`)
      await carregar()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setUploadando(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDeletar = async (doc: Documento) => {
    if (!confirm(`Remover "${doc.nome}" da base de conhecimento?`)) return
    setDeletandoId(doc.file_id)
    setErro('')
    try {
      const res = await fetch(`${API}/api/atlas/base_conhecimento/${doc.file_id}`, {
        method: 'DELETE',
        headers: headers()
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro)
      setSucesso(`"${doc.nome}" removido com sucesso.`)
      await carregar()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setDeletandoId(null)
    }
  }

  const totalBytes = docs.reduce((s, d) => s + d.tamanho, 0)

  return (
    <div style={{ padding: '32px 40px', maxWidth: 960, margin: '0 auto' }}>

      {/* Cabeçalho */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>
          🧠 Base de Conhecimento do Atlas
        </h1>
        <p style={{ fontSize: 13, color: '#8892a4' }}>
          Documentos indexados que o Atlas consulta automaticamente para responder com precisão.
        </p>
        {vsId && (
          <p style={{ fontSize: 11, color: '#3a3a50', marginTop: 4, fontFamily: 'monospace' }}>
            Vector Store: {vsId}
          </p>
        )}
      </div>

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Documentos', valor: loading ? '—' : docs.length.toString() },
          { label: 'Armazenamento', valor: loading ? '—' : formatarTamanho(totalBytes) },
          { label: 'Custo estimado/mês', valor: loading ? '—' : estimarCusto(docs) },
        ].map(m => (
          <div key={m.label} style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <p style={{ fontSize: 11, color: '#8892a4', marginBottom: 4 }}>{m.label}</p>
            <p style={{ fontSize: 22, fontWeight: 500, color: '#e2e8f0' }}>{m.valor}</p>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {erro && (
        <div style={{ background: '#ef444411', border: '0.5px solid #ef444433', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#ef4444' }}>
          ⚠️ {erro}
        </div>
      )}
      {sucesso && (
        <div style={{ background: '#10b98111', border: '0.5px solid #10b98133', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#10b981' }}>
          ✅ {sucesso}
        </div>
      )}

      {/* Área de upload */}
      <div
        style={{ border: '1px dashed #2d3148', borderRadius: 10, padding: '24px', textAlign: 'center', marginBottom: 20, background: '#13161f', cursor: 'pointer', transition: 'border-color .15s' }}
        onClick={() => fileRef.current?.click()}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#4f8ef755'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#2d3148'}
      >
        <input ref={fileRef} type="file" style={{ display: 'none' }}
          accept=".pdf,.docx,.doc,.txt,.md,.pptx,.ppt,.xlsx,.csv"
          onChange={handleUpload}
        />
        {uploadando ? (
          <p style={{ fontSize: 13, color: '#4f8ef7' }}>⏳ Enviando e indexando documento...</p>
        ) : (
          <>
            <p style={{ fontSize: 24, marginBottom: 8 }}>📄</p>
            <p style={{ fontSize: 13, color: '#8892a4', marginBottom: 4 }}>
              Clique para adicionar documento
            </p>
            <p style={{ fontSize: 11, color: '#3a3a50' }}>
              PDF, Word, TXT, Markdown, PowerPoint, Excel
            </p>
          </>
        )}
      </div>

      {/* Tabela de documentos */}
      <div style={{ border: '0.5px solid #2d3148', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 90px 80px', padding: '8px 16px', background: '#13161f', borderBottom: '0.5px solid #2d3148' }}>
          {['Nome', 'Tipo', 'Adicionado', 'Tamanho', 'Ação'].map(h => (
            <span key={h} style={{ fontSize: 11, color: '#8892a4', fontWeight: 500 }}>{h}</span>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#8892a4', fontSize: 13 }}>
            Carregando documentos...
          </div>
        ) : docs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#8892a4', marginBottom: 6 }}>Nenhum documento indexado ainda.</p>
            <p style={{ fontSize: 12, color: '#3a3a50' }}>
              Adicione contratos, POPs, ITOs, regulações da Anvisa e outros documentos para o Atlas consultar automaticamente.
            </p>
          </div>
        ) : (
          docs.map((doc, i) => {
            const ext = doc.nome.split('.').pop()?.toUpperCase() || '—'
            return (
              <div key={doc.file_id} style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 120px 90px 80px',
                padding: '10px 16px', alignItems: 'center',
                borderBottom: i < docs.length - 1 ? '0.5px solid #2d3148' : 'none',
                background: deletandoId === doc.file_id ? '#ef444408' : 'transparent',
                transition: 'background .15s'
              }}>
                <div style={{ overflow: 'hidden' }}>
                  <p style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.nome}
                  </p>
                  <p style={{ fontSize: 10, color: doc.status === 'completed' ? '#10b981' : '#f0b429', marginTop: 1 }}>
                    {doc.status === 'completed' ? '● Indexado' : '● Indexando...'}
                  </p>
                </div>
                <span style={{ fontSize: 12, color: '#8892a4' }}>{ext}</span>
                <span style={{ fontSize: 12, color: '#8892a4' }}>{formatarData(doc.criado_em)}</span>
                <span style={{ fontSize: 12, color: '#8892a4' }}>{formatarTamanho(doc.tamanho)}</span>
                <button
                  onClick={() => handleDeletar(doc)}
                  disabled={deletandoId === doc.file_id}
                  style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: deletandoId === doc.file_id ? 0.5 : 1 }}
                >
                  {deletandoId === doc.file_id ? 'Removendo...' : 'Remover'}
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Nota informativa */}
      <div style={{ marginTop: 16, padding: '10px 14px', background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 8 }}>
        <p style={{ fontSize: 12, color: '#8892a4', lineHeight: 1.6 }}>
          💡 O Atlas consulta automaticamente esta base ao responder perguntas. Documentos com status "Indexando..." ficam disponíveis em alguns segundos após o upload. O custo de armazenamento é de $0,10/GB/dia — para documentos de texto, o custo mensal é praticamente zero.
        </p>
      </div>

    </div>
  )
}