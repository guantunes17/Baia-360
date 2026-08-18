import React, { useEffect, useState, useRef } from 'react'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { addRipple } from '@/lib/ripple'
import { API } from '../config'

const token = () => localStorage.getItem('token') || ''
const headers = () => ({ Authorization: `Bearer ${token()}` })

type Base = 'comum' | 'restrita'

// Espelha BASES_VALIDAS/BASES_ROTULOS em backend/atlas_kb.py. O backend valida
// a base recebida contra a lista dele — esta é só a apresentação.
const BASES: { key: Base; rotulo: string; cor: string; descricao: string }[] = [
  {
    key: 'comum',
    rotulo: 'Base Comum',
    cor: T.accentBlue,
    descricao: 'Todo usuário do Atlas consulta. POPs, ITOs, contratos, material operacional.',
  },
  {
    key: 'restrita',
    rotulo: 'Base Restrita',
    cor: T.accentRed,
    descricao: 'Só usuários com a permissão "Base de conhecimento restrita". Regulatório (ANVISA), plantas físicas.',
  },
]

interface Documento {
  file_id:   string
  base:      Base
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
  const [docs,        setDocs]        = useState<Documento[]>([])
  const [bases,       setBases]       = useState<Record<string, string>>({})
  const [loading,     setLoading]     = useState(true)
  const [uploadando,  setUploadando]  = useState(false)
  const [deletandoId, setDeletandoId] = useState<string | null>(null)
  const [erro,        setErro]        = useState('')
  const [sucesso,     setSucesso]     = useState('')
  // Sem valor inicial de propósito: o upload fica bloqueado até o admin
  // escolher a base. Um default mandaria uma norma da ANVISA para a base
  // comum com um clique distraído, e o Vector Store não tem operação de
  // mover — o conserto seria remover e reindexar.
  const [baseDestino, setBaseDestino] = useState<Base | null>(null)
  const [filtroBase,  setFiltroBase]  = useState<Base | 'todas'>('todas')
  const fileRef = useRef<HTMLInputElement>(null)

  const carregar = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API}/api/atlas/base_conhecimento`, { headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro)
      setDocs(data.documentos || [])
      setBases(data.bases || {})
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !baseDestino) return
    setUploadando(true)
    setErro('')
    setSucesso('')
    try {
      const form = new FormData()
      form.append('arquivo', file)
      form.append('base', baseDestino)
      const res = await fetch(`${API}/api/atlas/base_conhecimento`, {
        method: 'POST',
        headers: headers(),
        body: form
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro)
      const rotulo = BASES.find(b => b.key === data.base)?.rotulo || data.base
      setSucesso(`"${data.nome}" enviado para a ${rotulo} e sendo indexado. Pode levar alguns segundos.`)
      await carregar()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setUploadando(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDeletar = async (doc: Documento) => {
    const rotulo = BASES.find(b => b.key === doc.base)?.rotulo || doc.base
    if (!confirm(`Remover "${doc.nome}" da ${rotulo}?`)) return
    setDeletandoId(doc.file_id)
    setErro('')
    try {
      const res = await fetch(`${API}/api/atlas/base_conhecimento/${doc.file_id}?base=${doc.base}`, {
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

  const docsVisiveis = filtroBase === 'todas' ? docs : docs.filter(d => d.base === filtroBase)
  const totalBytes = docsVisiveis.reduce((s, d) => s + d.tamanho, 0)
  const podeEnviar = baseDestino !== null && !!bases[baseDestino]

  return (
    <div style={{ padding: '32px 40px', maxWidth: 960, margin: '0 auto' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: T.text, marginBottom: 4 }}>
          Base de Conhecimento do Atlas
        </h1>
        <p style={{ fontSize: 13, color: T.textMuted }}>
          Documentos indexados que o Atlas consulta automaticamente para responder com precisão.
        </p>
      </div>

      {/* Contagem por base sempre visível, mesmo com filtro aplicado — é o que
          responde "o documento restrito foi mesmo para a base certa?". */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          ...BASES.map(b => ({
            label: b.rotulo,
            valor: loading ? '—'
                 : !bases[b.key] ? 'não configurada'
                 : docs.filter(d => d.base === b.key).length.toString(),
            cor:   bases[b.key] ? b.cor : T.textDim,
          })),
          { label: 'Armazenamento',      valor: loading ? '—' : formatarTamanho(totalBytes), cor: T.text },
          { label: 'Custo estimado/mês', valor: loading ? '—' : estimarCusto(docsVisiveis),  cor: T.text },
        ].map(m => (
          <div key={m.label} style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 10, padding: '14px 16px' }}>
            <p style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>{m.label}</p>
            <p style={{ fontSize: m.valor === 'não configurada' ? 13 : 22, fontWeight: 500, color: m.cor }}>{m.valor}</p>
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

      {/* Escolha da base de destino — obrigatória antes do upload. */}
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Enviar para
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          {BASES.map(b => {
            const configurada = !!bases[b.key]
            const ativa = baseDestino === b.key
            return (
              <button
                key={b.key}
                onClick={() => configurada && setBaseDestino(b.key)}
                disabled={!configurada}
                title={configurada ? b.descricao : `Base não configurada no servidor.`}
                style={{
                  flex: 1, textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                  background: ativa ? `${b.cor}18` : T.bg,
                  border: `1px solid ${ativa ? b.cor + '66' : T.border}`,
                  cursor: configurada ? 'pointer' : 'not-allowed',
                  opacity: configurada ? 1 : 0.45,
                }}
              >
                <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: ativa ? b.cor : T.text }}>
                  {b.rotulo}{!configurada && ' — não configurada'}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                  {b.descricao}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div
        style={{
          border: `1px dashed ${T.border}`, borderRadius: 10, padding: 24, textAlign: 'center',
          marginBottom: 20, background: T.bg, position: 'relative', overflow: 'hidden',
          transition: 'border-color .15s, opacity .15s',
          cursor: podeEnviar ? 'pointer' : 'not-allowed',
          pointerEvents: podeEnviar ? 'auto' : 'none',
          opacity: podeEnviar ? 1 : 0.5,
        }}
        onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>, undefined, 0.15); fileRef.current?.click() }}
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
              {podeEnviar ? 'Clique para adicionar documento' : 'Selecione a base de destino acima'}
            </p>
            <p style={{ fontSize: 11, color: T.textDim }}>
              PDF, Word, TXT, Markdown, PowerPoint, Excel
            </p>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {([['todas', 'Todas'], ...BASES.map(b => [b.key, b.rotulo] as const)] as const).map(([key, rotulo]) => (
          <button
            key={key}
            onClick={() => setFiltroBase(key as Base | 'todas')}
            style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 999,
              background: filtroBase === key ? `${T.accentBlue}18` : 'transparent',
              border: `1px solid ${filtroBase === key ? T.accentBlue + '55' : T.border}`,
              color: filtroBase === key ? T.accentBlue : T.textMuted, cursor: 'pointer',
            }}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 110px 90px 80px', padding: '8px 16px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
          {['Nome', 'Base', 'Tipo', 'Adicionado', 'Tamanho', 'Ação'].map(h => (
            <span key={h} style={{ fontSize: 11, color: T.textMuted, fontWeight: 500 }}>{h}</span>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
            Carregando documentos...
          </div>
        ) : docsVisiveis.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 6 }}>Nenhum documento indexado ainda.</p>
            <p style={{ fontSize: 12, color: T.textDim }}>
              Adicione contratos, POPs, ITOs, regulações da Anvisa e outros documentos para o Atlas consultar automaticamente.
            </p>
          </div>
        ) : (
          docsVisiveis.map((doc, i) => {
            const ext = doc.nome.split('.').pop()?.toUpperCase() || '—'
            const meta = BASES.find(b => b.key === doc.base)
            return (
              <div key={doc.file_id} style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 70px 110px 90px 80px',
                padding: '10px 16px', alignItems: 'center',
                borderBottom: i < docsVisiveis.length - 1 ? `1px solid ${T.border}` : 'none',
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
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 999, justifySelf: 'start',
                  color: meta?.cor || T.textMuted,
                  background: `${meta?.cor || T.textMuted}14`,
                  border: `1px solid ${meta?.cor || T.textMuted}33`,
                }}>
                  {meta?.rotulo || doc.base}
                </span>
                <span style={{ fontSize: 12, color: T.textMuted }}>{ext}</span>
                <span style={{ fontSize: 12, color: T.textMuted }}>{formatarData(doc.criado_em)}</span>
                <span style={{ fontSize: 12, color: T.textMuted }}>{formatarTamanho(doc.tamanho)}</span>
                <button
                  onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>, T.accentRed, 0.2); handleDeletar(doc) }}
                  disabled={deletandoId === doc.file_id}
                  style={{ fontSize: 12, color: T.accentRed, background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: deletandoId === doc.file_id ? 0.5 : 1, position: 'relative', overflow: 'hidden' }}
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
          💡 O Atlas consulta automaticamente a Base Comum para todos os usuários, e a Base Restrita apenas para quem tem a permissão correspondente (tela de Usuários → Permissões). Documentos com status "Indexando..." ficam disponíveis em alguns segundos após o upload.
        </p>
        <p style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, marginTop: 8 }}>
          ⚠️ Não é possível mover um documento entre bases: o Vector Store da OpenAI não tem essa operação. Para corrigir uma classificação errada, remova o documento e envie novamente escolhendo a base correta.
        </p>
      </div>

    </div>
  )
}
