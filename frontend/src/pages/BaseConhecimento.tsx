import { useEffect, useState, useRef } from 'react'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { API } from '../config'

const token = () => localStorage.getItem('token') || ''
const headers = () => ({ Authorization: `Bearer ${token()}` })

interface Documento {
  file_id:   string
  nome:      string
  tamanho:   number
  status:    string
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
  const [docs,       setDocs]       = useState<Documento[]>([])
  const [vsId,       setVsId]       = useState('')
  const [loading,    setLoading]    = useState(true)
  const [uploadando, setUploadando] = useState(false)
  const [deletandoId, setDeletandoId] = useState<string | null>(null)
  const [erro,       setErro]       = useState('')
  const [sucesso,    setSucesso]    = useState('')
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

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: T.text, marginBottom: 4 }}>
          Base de Conhecimento do Atlas
        </h1>
        <p style={{ fontSize: 13, color: T.textMuted }}>
          Documentos indexados que o Atlas consulta automaticamente para responder com precisão.
        </p>
        {vsId && (
          <p style={{ fontSize: 11, color: T.textDim, marginTop: 4, fontFamily: 'monospace' }}>
            Vector Store: {vsId}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Documentos',         valor: loading ? '—' : docs.length.toString() },
          { label: 'Armazenamento',      valor: loading ? '—' : formatarTamanho(totalBytes) },
          { label: 'Custo estimado/mês', valor: loading ? '—' : estimarCusto(docs) },
        ].map(m => (
          <div key={m.label} style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 10, padding: '14px 16px' }}>
            <p style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>{m.label}</p>
            <p style={{ fontSize: 22, fontWeight: 500, color: T.text }}>{m.valor}</p>
          </div>
        ))}
      </div>

      {erro && (
        <div style={{ background: `${T.accentRed}11`, border: `1px solid ${T.accentRed}33`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: T.accentRed }}>
          ⚠️ {erro}
        </div>
      )}
      {sucesso && (
        <div style={{ background: `${T.accentGreen}11`, border: `1px solid ${T.accentGreen}33`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: T.accentGreen }}>
          ✅ {sucesso}
        </div>
      )}

      <div
        style={{ border: `1px dashed ${T.border}`, borderRadius: 10, padding: 24, textAlign: 'center', marginBottom: 20, background: T.bg, cursor: 'pointer', transition: 'border-color .15s' }}
        onClick={() => fileRef.current?.click()}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}55`}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = T.border}
      >
        <input ref={fileRef} type="file" style={{ display: 'none' }}
          accept=".pdf,.docx,.doc,.txt,.md,.pptx,.ppt,.xlsx,.csv"
          onChange={handleUpload}
        />
        {uploadando ? (
          <p style={{ fontSize: 13, color: T.accentBlue }}>⏳ Enviando e indexando documento...</p>
        ) : (
          <>
            <p style={{ fontSize: 24, marginBottom: 8 }}>📄</p>
            <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>
              Clique para adicionar documento
            </p>
            <p style={{ fontSize: 11, color: T.textDim }}>
              PDF, Word, TXT, Markdown, PowerPoint, Excel
            </p>
          </>
        )}
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 90px 80px', padding: '8px 16px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
          {['Nome', 'Tipo', 'Adicionado', 'Tamanho', 'Ação'].map(h => (
            <span key={h} style={{ fontSize: 11, color: T.textMuted, fontWeight: 500 }}>{h}</span>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
            Carregando documentos...
          </div>
        ) : docs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 6 }}>Nenhum documento indexado ainda.</p>
            <p style={{ fontSize: 12, color: T.textDim }}>
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
                borderBottom: i < docs.length - 1 ? `1px solid ${T.border}` : 'none',
                background: deletandoId === doc.file_id ? `${T.accentRed}08` : 'transparent',
                transition: 'background .15s'
              }}>
                <div style={{ overflow: 'hidden' }}>
                  <p style={{ fontSize: 13, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.nome}
                  </p>
                  <p style={{ fontSize: 10, color: doc.status === 'completed' ? T.accentGreen : T.gold, marginTop: 1 }}>
                    {doc.status === 'completed' ? '● Indexado' : '● Indexando...'}
                  </p>
                </div>
                <span style={{ fontSize: 12, color: T.textMuted }}>{ext}</span>
                <span style={{ fontSize: 12, color: T.textMuted }}>{formatarData(doc.criado_em)}</span>
                <span style={{ fontSize: 12, color: T.textMuted }}>{formatarTamanho(doc.tamanho)}</span>
                <button
                  onClick={() => handleDeletar(doc)}
                  disabled={deletandoId === doc.file_id}
                  style={{ fontSize: 12, color: T.accentRed, background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: deletandoId === doc.file_id ? 0.5 : 1 }}
                >
                  {deletandoId === doc.file_id ? 'Removendo...' : 'Remover'}
                </button>
              </div>
            )
          })
        )}
      </div>

      <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 8, marginTop: 16, padding: '10px 14px' }}>
        <p style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>
          💡 O Atlas consulta automaticamente esta base ao responder perguntas. Documentos com status "Indexando..." ficam disponíveis em alguns segundos após o upload. O custo de armazenamento é de $0,10/GB/dia — para documentos de texto, o custo mensal é praticamente zero.
        </p>
      </div>

    </div>
  )
}
