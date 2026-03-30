import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'

const API = 'http://localhost:5001'

const TOOLS_DEF = [
  { id: 'get_dashboard', name: 'get_dashboard', on: true,
    declaration: { name: 'get_dashboard', description: 'Retorna KPIs e histórico de relatórios gerados. Use quando o usuário perguntar sobre métricas, faturamento, SLA, estoque, ou qualquer dado operacional.', parameters: { type: 'object', properties: { modulo: { type: 'string', description: 'Filtrar por módulo específico (opcional).' } }, required: [] } }
  },
  { id: 'gerar_relatorio', name: 'gerar_relatorio', on: true,
    declaration: { name: 'gerar_relatorio', description: 'Inicia a geração de um relatório para um módulo e mês de referência. Após chamar esta ferramenta, informe ao usuário que ele precisa enviar o arquivo Excel correspondente para continuar.', parameters: { type: 'object', properties: { modulo: { type: 'string', description: 'Nome do módulo: Pedidos, Fretes, Armazenagem, Estoque, Cap. Operacional, Recebimentos, Fat. Distribuição, Fat. Armazenagem' }, mes_ref: { type: 'string', description: 'Mês de referência no formato YYYY-MM. Ex: 2025-03' } }, required: ['modulo', 'mes_ref'] } }
  },
  { id: 'get_agenda', name: 'get_agenda', on: true,
    declaration: { name: 'get_agenda', description: 'Retorna eventos da agenda do usuário no Outlook.', parameters: { type: 'object', properties: { data_inicio: { type: 'string', description: 'Data inicial YYYY-MM-DD' }, data_fim: { type: 'string', description: 'Data final YYYY-MM-DD' } }, required: [] } }
  },
  { id: 'criar_evento', name: 'criar_evento', on: true,
    declaration: { name: 'criar_evento', description: 'Cria um novo evento na agenda do Outlook.', parameters: { type: 'object', properties: { titulo: { type: 'string' }, data: { type: 'string', description: 'YYYY-MM-DD' }, hora_inicio: { type: 'string', description: 'HH:MM' }, hora_fim: { type: 'string', description: 'HH:MM' }, descricao: { type: 'string' } }, required: ['titulo', 'data', 'hora_inicio', 'hora_fim'] } }
  }
]

const MOCK_RESPONSES: Record<string, (args: any) => any> = {
  get_dashboard: () => ({
    kpis_por_modulo: {
      Pedidos: { mes_ref: '2025-03', kpis: { total_pedidos: 1842, sla_entrega: '96.3%', pedidos_atrasados: 67 } },
      Fretes: { mes_ref: '2025-03', kpis: { total_fretes: 312, custo_total: 148500, custo_medio: 476 } },
      Armazenagem: { mes_ref: '2025-03', kpis: { pico_m3: 3240, media_m3: 2890, clientes_ativos: 12 } },
      Estoque: { mes_ref: '2025-03', kpis: { skus_ativos: 4821, valor_total: 9200000, giro_medio: 18.4 } },
    }
  }),
  gerar_relatorio: ({ modulo, mes_ref }: any) => ({ status: 'aguardando_arquivo', modulo, mes_ref, mensagem: `Aguardando arquivo Excel para ${modulo} (${mes_ref}).` }),
  get_agenda: () => ({ eventos: [
    { titulo: 'Reunião operacional', data: '2025-03-27', hora: '09:00' },
    { titulo: 'Revisão de KPIs Março', data: '2025-03-28', hora: '14:00' },
    { titulo: 'Call BIOGEN', data: '2025-03-29', hora: '11:00' },
  ]}),
  criar_evento: ({ titulo, data, hora_inicio, hora_fim }: any) => ({ status: 'criado', mensagem: `Evento "${titulo}" criado para ${data} das ${hora_inicio} às ${hora_fim}.` })
}

const ENDPOINT_MAP: Record<string, string> = {
  'Pedidos': 'pedidos', 'Fretes': 'fretes', 'Armazenagem': 'armazenagem',
  'Estoque': 'estoque', 'Cap. Operacional': 'cap_operacional',
  'Recebimentos': 'recebimentos', 'Fat. Distribuição': 'fat_dist', 'Fat. Armazenagem': 'fat_arm'
}

interface Msg {
  role: 'user' | 'assistant' | 'note'
  text: string
  tools?: string[]
  streaming?: boolean
  arquivo?: { nome: string }
}

interface ArquivoPendente {
  file: File
  modulo: string
  mes_ref: string
}

// Arquivo enviado para interpretação pelo Atlas
interface ArquivoContexto {
  file_uri: string
  mime_type: string
  nome: string
}

interface Conversa {
  id: string
  titulo: string
  msgs: Msg[]
  history: any[]
  criadaEm: Date
}

function gerarId() { return Math.random().toString(36).slice(2, 10) }

function novaConversa(): Conversa {
  return {
    id: gerarId(),
    titulo: 'Nova conversa',
    msgs: [{ role: 'note', text: 'Atlas pronto. Como posso ajudar?' }],
    history: [],
    criadaEm: new Date()
  }
}

export function Atlas({ nomeUsuario }: { nomeUsuario: string }) {
  const [conversas, setConversas] = useState<Conversa[]>([novaConversa()])
  const [ativaId, setAtivaId] = useState<string>(() => conversas[0].id)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [arquivoPendente, setArquivoPendente] = useState<ArquivoPendente | null>(null)
  const [uploadInfo, setUploadInfo] = useState<{ modulo: string; mes_ref: string } | null>(null)
  const [arquivoContexto, setArquivoContexto] = useState<ArquivoContexto | null>(null)
  const [uploadandoArquivo, setUploadandoArquivo] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileContextoRef = useRef<HTMLInputElement>(null)
  const token = localStorage.getItem('token') || ''

  const SYSTEM_PROMPT = `Você é o Atlas, assistente de inteligência artificial da Baia 4 Logística e Transportes.

Você está conversando com ${nomeUsuario}.

Personalidade e estilo de resposta:
- Você tem personalidade própria — é direto, inteligente e ocasionalmente usa humor leve quando o contexto permite
- Use o nome ${nomeUsuario} naturalmente nas respostas, como um colega faria — não em toda mensagem, apenas quando fizer sentido
- Escreva em texto corrido, como uma pessoa escreveria — evite listas com marcadores a menos que o conteúdo realmente exija
- Respostas curtas para perguntas simples, mais detalhadas apenas quando necessário
- Nunca comece respostas com "Com certeza!", "Claro!", "Ótimo!" ou variações robóticas
- Não repita o que o usuário acabou de dizer antes de responder
- Quando não souber algo, diga diretamente — sem rodeios
- Use dados antes de especular
- Responda sempre em português brasileiro informal mas profissional

Capacidades:
- Consulta e análise de KPIs e relatórios operacionais via ferramentas
- Geração de relatórios (requer upload do arquivo Excel correspondente)
- Consulta e criação de eventos na agenda (Outlook)
- Interpretação de arquivos enviados pelo usuário (Excel, PDF, Word, imagens)
- Responder perguntas gerais sobre logística, operações ou qualquer outro assunto

Contexto da empresa:
- Baia 4 é um operador logístico focado em distribuição farmacêutica
- Clientes: ADITUS, BIOGEN, EPHARMA, BHC-Xofigo, CSL BEHRING, IPSEN, CELLTRION, YELUM, CM HOSPITALAR, GSK, PINT PHARMA, FUNCIONAL
- Módulos: Pedidos, Fretes, Armazenagem, Estoque, Cap. Operacional, Recebimentos, Fat. Distribuição, Fat. Armazenagem

Sobre arquivos enviados pelo usuário:
- Quando o usuário enviar qualquer arquivo (Excel, PDF, Word, imagem), analise o conteúdo e responda o que foi pedido
- Para arquivos Excel, PDF, Word e imagens, leia os dados e forneça insights, resumos, análises ou responda perguntas sobre o conteúdo
- Nunca diga que não consegue ler ou interpretar um arquivo — você tem essa capacidade
- A geração de relatórios é um fluxo separado que usa arquivos de entrada específicos da operação. Não confunda com arquivos enviados para análise
- Quando receber um arquivo, você TEM acesso ao conteúdo real dele — leia e analise de verdade, nunca diga que não consegue ler

Sobre geração de relatórios operacionais:
- Quando o usuário pedir para GERAR um relatório operacional (Pedidos, Fretes, etc.), use a ferramenta gerar_relatorio e informe que um botão aparecerá para enviar o arquivo Excel correspondente`

  const conversa = conversas.find(c => c.id === ativaId)!

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversa?.msgs])

  const updateConversa = useCallback((id: string, fn: (c: Conversa) => Conversa) => {
    setConversas(prev => prev.map(c => c.id === id ? fn(c) : c))
  }, [])

  const criarNovaConversa = () => {
    const nova = novaConversa()
    setConversas(prev => [nova, ...prev])
    setAtivaId(nova.id)
    setInput('')
    setUploadInfo(null)
    setArquivoPendente(null)
    setArquivoContexto(null)
    inputRef.current?.focus()
  }

  const deletarConversa = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConversas(prev => {
      const restantes = prev.filter(c => c.id !== id)
      if (restantes.length === 0) {
        const nova = novaConversa()
        setAtivaId(nova.id)
        return [nova]
      }
      if (ativaId === id) setAtivaId(restantes[0].id)
      return restantes
    })
  }

  const addMsgToConversa = (convId: string, msg: Msg, replace = false) => {
    updateConversa(convId, c => {
      if (replace) {
        const msgs = [...c.msgs]
        msgs[msgs.length - 1] = msg
        return { ...c, msgs }
      }
      return { ...c, msgs: [...c.msgs, msg] }
    })
  }

  const callBackend = async (endpoint: string, payload: any) => {
    const res = await axios.post(`${API}${endpoint}`, payload, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.data
  }

  // Upload de arquivo para interpretação pelo Atlas
  const handleArquivoContexto = async (file: File) => {
    setUploadandoArquivo(true)
    try {
      const formData = new FormData()
      formData.append('arquivo', file)
      const res = await fetch(`${API}/api/atlas/upload_arquivo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Erro ao enviar arquivo')
      setArquivoContexto({ file_uri: data.file_uri, mime_type: data.mime_type, nome: data.nome })
    } catch (e: any) {
      addMsgToConversa(ativaId, { role: 'note', text: 'Erro ao enviar arquivo: ' + e.message })
    } finally {
      setUploadandoArquivo(false)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (loading) return
    if (!text && !arquivoPendente && !arquivoContexto) return

    setInput('')
    setLoading(true)
    const convId = ativaId

    const activeTools = TOOLS_DEF.filter(t => t.on).map(t => t.declaration)
    const base = {
      model: 'gemini-2.5-flash',
      temperature: 1.0,
      system_prompt: SYSTEM_PROMPT,
      tools: activeTools
    }

    // ── Fluxo com arquivo pendente para geração de relatório ──
    if (arquivoPendente) {
      const { file, modulo, mes_ref } = arquivoPendente
      setArquivoPendente(null)
      setUploadInfo(null)

      addMsgToConversa(convId, { role: 'user', text: `📎 ${file.name}`, arquivo: { nome: file.name } })
      addMsgToConversa(convId, { role: 'assistant', text: 'Processando arquivo...', streaming: true })

      try {
        const endpoint = ENDPOINT_MAP[modulo]
        if (!endpoint) throw new Error(`Módulo desconhecido: ${modulo}`)

        const formData = new FormData()
        formData.append('arquivo', file)
        formData.append('mes_ref', mes_ref)

        const res = await fetch(`${API}/api/modulos/${endpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.erro || 'Erro ao iniciar geração')

        const job_id = data.job_id
        addMsgToConversa(convId, { role: 'assistant', text: `Relatório de **${modulo}** (${mes_ref}) em processamento. Aguarde...`, streaming: false }, true)

        const poll = setInterval(async () => {
          try {
            const statusRes = await fetch(`${API}/api/modulos/status/${job_id}`, {
              headers: { Authorization: `Bearer ${token}` }
            })
            const statusData = await statusRes.json()
            if (statusData.status === 'concluido') {
              clearInterval(poll)
              const downloadUrl = `${API}/api/modulos/download/${job_id}?token=${token}`
              updateConversa(convId, c => {
                const msgs = [...c.msgs]
                msgs[msgs.length - 1] = {
                  role: 'assistant',
                  text: `✅ Relatório de **${modulo}** (${mes_ref}) gerado com sucesso!\n\n[📥 Baixar relatório](${downloadUrl})`,
                  streaming: false
                }
                return { ...c, msgs }
              })
              setLoading(false)
            } else if (statusData.status === 'erro') {
              clearInterval(poll)
              addMsgToConversa(convId, { role: 'note', text: 'Erro na geração: ' + (statusData.erro || 'desconhecido') }, true)
              setLoading(false)
            }
          } catch { clearInterval(poll); setLoading(false) }
        }, 2000)

      } catch (e: any) {
        updateConversa(convId, c => {
          const msgs = [...c.msgs]
          msgs[msgs.length - 1] = { role: 'note', text: 'Erro: ' + e.message, streaming: false }
          return { ...c, msgs, history: [] }
        })
        setLoading(false)
      }
      return
    }

    // ── Fluxo normal de chat (com ou sem arquivo de contexto) ──
    const ctx = arquivoContexto
    setArquivoContexto(null)

    // Monta a mensagem do usuário — com arquivo se houver
    const userMsgText = ctx ? `📎 ${ctx.nome}${text ? `\n${text}` : ''}` : text
    const userPrompt = text || `Analise o arquivo "${ctx?.nome}" que acabei de enviar.`

    updateConversa(convId, c => ({
      ...c,
      titulo: c.titulo === 'Nova conversa' ? userMsgText.slice(0, 40) : c.titulo,
      msgs: [...c.msgs, { role: 'user', text: userMsgText, arquivo: ctx ? { nome: ctx.nome } : undefined }, { role: 'assistant', text: '', streaming: true }],
      history: [...c.history, { role: 'user', parts: ctx
        ? [{ text: userPrompt }, { file_data: { mime_type: ctx.mime_type, file_uri: ctx.file_uri } }]
        : [{ text: userPrompt }]
      }]
    }))

    const currentHistory = [...(conversa.history), { role: 'user', parts: ctx
      ? [{ text: userPrompt }, { file_data: { mime_type: ctx.mime_type, file_uri: ctx.file_uri } }]
      : [{ text: userPrompt }]
    }]

    try {
      const res = await axios.post(`${API}/api/atlas/chat`,
        { ...base, history: currentHistory },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const finalParts: any[] = res.data.parts || []
      const streamedText = finalParts.find((p: any) => p.text)?.text || ''

      updateConversa(convId, c => {
        const msgs = [...c.msgs]
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: streamedText, streaming: false }
        return { ...c, msgs }
      })

      const fnCalls = finalParts.filter((p: any) => p.functionCall)
      const toolNames = fnCalls.map((p: any) => p.functionCall.name)
      const newHistory = [...currentHistory, { role: 'model', parts: finalParts }]

      if (fnCalls.length > 0) {
        updateConversa(convId, c => {
          const msgs = [...c.msgs]
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: 'Consultando...', streaming: true, tools: toolNames }
          return { ...c, msgs }
        })

        const gerarCall = fnCalls.find((p: any) => p.functionCall.name === 'gerar_relatorio')

        if (gerarCall) {
          const { modulo, mes_ref } = gerarCall.functionCall.args
          setUploadInfo({ modulo, mes_ref })
          const fnResponses = fnCalls.map((p: any) => ({
            functionResponse: {
              name: p.functionCall.name,
              response: { result: { status: 'aguardando_arquivo', mensagem: `Aguardando upload do arquivo Excel para ${modulo} (${mes_ref}).` } }
            }
          }))
          const h3 = [...newHistory, { role: 'user', parts: fnResponses }]
          const data2 = await callBackend('/api/atlas/chat/tool_response', { ...base, history: h3 })
          const parts2: any[] = data2.parts || []
          updateConversa(convId, c => {
            const msgs = [...c.msgs]
            msgs[msgs.length - 1] = {
              role: 'assistant',
              text: parts2.find((p: any) => p.text)?.text || `Por favor, envie o arquivo Excel de **${modulo}** usando o botão abaixo.`,
              tools: toolNames, streaming: false
            }
            return { ...c, msgs, history: [...h3, { role: 'model', parts: parts2 }] }
          })
        } else {
          const fnResponses = fnCalls.map((p: any) => {
            const fn = p.functionCall
            const result = MOCK_RESPONSES[fn.name] ? MOCK_RESPONSES[fn.name](fn.args || {}) : { erro: 'não implementado' }
            return { functionResponse: { name: fn.name, response: { result } } }
          })
          const h3 = [...newHistory, { role: 'user', parts: fnResponses }]
          const data2 = await callBackend('/api/atlas/chat/tool_response', { ...base, history: h3 })
          const parts2: any[] = data2.parts || []
          updateConversa(convId, c => {
            const msgs = [...c.msgs]
            msgs[msgs.length - 1] = {
              role: 'assistant',
              text: parts2.find((p: any) => p.text)?.text || '(sem resposta)',
              tools: toolNames, streaming: false
            }
            return { ...c, msgs, history: [...h3, { role: 'model', parts: parts2 }] }
          })
        }
      } else {
        updateConversa(convId, c => {
          const msgs = [...c.msgs]
          msgs[msgs.length - 1] = { role: 'assistant', text: streamedText || '(sem resposta)', streaming: false }
          return { ...c, msgs, history: newHistory }
        })
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.erro || e.message || 'Erro desconhecido'
      updateConversa(convId, c => {
        const msgs = [...c.msgs]
        msgs[msgs.length - 1] = { role: 'note', text: 'Erro: ' + errMsg, streaming: false }
        return { ...c, msgs, history: [] }
      })
    }

    setLoading(false)
    inputRef.current?.focus()
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>

      {/* Sidebar */}
      <div style={{ width: 240, background: '#13161f', borderRight: '1px solid #2d3148', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px' }}>
          <button
            onClick={criarNovaConversa}
            style={{ width: '100%', padding: '9px 14px', borderRadius: 8, background: '#4f8ef711', border: '1px solid #4f8ef733', color: '#4f8ef7', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}
          >
            <span style={{ fontSize: 16 }}>+</span> Nova conversa
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
          {conversas.map(c => (
            <div
              key={c.id}
              onClick={() => { setAtivaId(c.id); setUploadInfo(null); setArquivoPendente(null); setArquivoContexto(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '8px 10px', borderRadius: 7, marginBottom: 2,
                background: c.id === ativaId ? '#1a1d27' : 'transparent',
                border: c.id === ativaId ? '1px solid #2d3148' : '1px solid transparent',
                cursor: 'pointer'
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: c.id === ativaId ? '#e2e8f0' : '#8892a4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                🤖 {c.titulo}
              </span>
              <button
                onClick={e => deletarConversa(c.id, e)}
                style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 4, background: 'none', border: 'none', color: '#8892a4', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity .15s' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                title="Deletar conversa"
              >✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 10%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {conversa.msgs.map((m, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              maxWidth: m.role === 'note' ? '100%' : m.role === 'user' ? '70%' : '100%',
              alignSelf: m.role === 'user' ? 'flex-end' : m.role === 'note' ? 'center' : 'flex-start',
              alignItems: m.role === 'user' ? 'flex-end' : m.role === 'note' ? 'center' : 'flex-start',
            }}>
              {m.tools && m.tools.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {m.tools.map(t => (
                    <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#1a1d2799', border: '1px solid #7c3aed55', color: '#7c3aed', fontFamily: 'monospace' }}>{t}</span>
                  ))}
                </div>
              )}

              {m.role === 'user' && (
                <div style={{ padding: '10px 16px', borderRadius: 18, background: '#1e2133', color: '#e2e8f0', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                  {m.arquivo && <span style={{ fontSize: 12, color: '#8892a4', display: 'block', marginBottom: 4 }}>📎 {m.arquivo.nome}</span>}
                  {m.text.replace(`📎 ${m.arquivo?.nome}\n`, '').replace(`📎 ${m.arquivo?.nome}`, '') || null}
                </div>
              )}

              {m.role === 'assistant' && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <style>{`
                          @keyframes globoRoda { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                          @keyframes globoPulsa { 0%,100% { opacity:0.7; } 50% { opacity:1; } }
                          .globo-spin-${i} { transform-origin: 14px 14px; animation: ${m.streaming ? 'globoRoda 3s linear infinite' : 'none'}; }
                          .globo-pulsa-${i} { animation: ${m.streaming ? 'globoPulsa 1.5s ease-in-out infinite' : 'none'}; }
                        `}</style>
                        <clipPath id={`globoClip-${i}`}><circle cx="14" cy="14" r="11" /></clipPath>
                      </defs>
                      <circle cx="14" cy="14" r="11" stroke="#ffffff" strokeOpacity={m.streaming ? '0.9' : '0.5'} strokeWidth="1" fill="none" className={`globo-pulsa-${i}`} />
                      <g className={`globo-spin-${i}`} clipPath={`url(#globoClip-${i})`}>
                        <ellipse cx="14" cy="14" rx="11" ry="4" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.8" fill="none" />
                        <ellipse cx="14" cy="14" rx="5" ry="11" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.8" fill="none" />
                        <ellipse cx="14" cy="14" rx="9" ry="11" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="0.6" fill="none" />
                        <ellipse cx="14" cy="9" rx="7.5" ry="2.5" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="0.6" fill="none" />
                        <ellipse cx="14" cy="19" rx="7.5" ry="2.5" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="0.6" fill="none" />
                      </g>
                      {m.streaming && <circle cx="14" cy="14" r="2" fill="#a78bfa" className={`globo-pulsa-${i}`} />}
                    </svg>
                  </div>
                  <div style={{ flex: 1, color: '#e2e8f0', fontSize: 14, lineHeight: 1.75, paddingTop: 4 }}>
                    {m.streaming && !m.text ? (
                      <span style={{ display: 'flex', gap: 4, alignItems: 'center', height: 20, marginTop: 4 }}>
                        {[0, 1, 2].map(j => (
                          <span key={j} style={{ width: 5, height: 5, borderRadius: '50%', background: '#8892a4', display: 'inline-block', animation: `bounce 1.2s ${j * 0.2}s infinite` }} />
                        ))}
                      </span>
                    ) : (
                      <div>
                        <ReactMarkdown components={{
                          p: ({ children }) => <p style={{ margin: '0 0 8px 0' }}>{children}</p>,
                          strong: ({ children }) => <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>{children}</strong>,
                          ul: ({ children }) => <ul style={{ margin: '4px 0 8px 0', paddingLeft: 20 }}>{children}</ul>,
                          ol: ({ children }) => <ol style={{ margin: '4px 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
                          li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
                          code: ({ children }) => <code style={{ fontFamily: 'monospace', background: '#0f1117', padding: '1px 6px', borderRadius: 4, fontSize: 13, color: '#a78bfa' }}>{children}</code>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: '#4f8ef7', textDecoration: 'underline' }}>{children}</a>,
                        }}>{m.text}</ReactMarkdown>
                        {m.streaming && <span style={{ display: 'inline-block', width: 2, height: 15, background: '#4f8ef7', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s infinite' }} />}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {m.role === 'note' && (
                <div style={{ fontSize: 11, color: '#8892a455', padding: '2px 0' }}>{m.text}</div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <style>{`
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
          @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
        `}</style>

        <div style={{ padding: '16px 10%', borderTop: '1px solid #2d3148', background: '#0f1117' }}>

          {/* Banner upload para geração de relatório */}
          {uploadInfo && (
            <div style={{ marginBottom: 10, padding: '10px 16px', background: '#1a1d27', border: '1px solid #4f8ef733', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13, color: '#8892a4' }}>
                📎 Envie o arquivo Excel de <strong style={{ color: '#e2e8f0' }}>{uploadInfo.modulo}</strong> ({uploadInfo.mes_ref})
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => fileInputRef.current?.click()} style={{ padding: '5px 14px', borderRadius: 6, background: '#4f8ef7', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Selecionar arquivo
                </button>
                <button onClick={() => { setUploadInfo(null); setArquivoPendente(null) }} style={{ padding: '5px 10px', borderRadius: 6, background: 'none', color: '#8892a4', border: '1px solid #2d3148', fontSize: 12, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Preview arquivo de contexto selecionado */}
          {arquivoContexto && (
            <div style={{ marginBottom: 8, padding: '6px 12px', background: '#1a1d27', border: '1px solid #7c3aed33', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#a78bfa' }}>📎 {arquivoContexto.nome}</span>
              <button onClick={() => setArquivoContexto(null)} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          )}

          {/* Input oculto para relatório */}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file && uploadInfo) setArquivoPendente({ file, modulo: uploadInfo.modulo, mes_ref: uploadInfo.mes_ref })
              e.target.value = ''
            }}
          />

          {/* Input oculto para arquivo de contexto */}
          <input ref={fileContextoRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleArquivoContexto(file)
              e.target.value = ''
            }}
          />

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 12, padding: '8px 8px 8px 12px' }}>
            {/* Botão clipe para arquivo de contexto */}
            <button
              onClick={() => fileContextoRef.current?.click()}
              disabled={loading || uploadandoArquivo || !!uploadInfo}
              title="Enviar arquivo para o Atlas analisar"
              style={{
                flexShrink: 0, width: 32, height: 32, borderRadius: 8,
                background: 'none', border: 'none',
                color: uploadandoArquivo ? '#4f8ef7' : '#8892a4',
                cursor: loading || uploadandoArquivo || !!uploadInfo ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, opacity: uploadInfo ? 0.3 : 1, transition: 'color .15s'
              }}
              onMouseEnter={e => { if (!loading && !uploadandoArquivo && !uploadInfo) (e.currentTarget as HTMLElement).style.color = '#e2e8f0' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = uploadandoArquivo ? '#4f8ef7' : '#8892a4' }}
            >
              {uploadandoArquivo ? '⏳' : '📎'}
            </button>

            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={
                uploadandoArquivo ? 'Enviando arquivo...' :
                arquivoContexto ? `📎 ${arquivoContexto.nome} — digite sua pergunta ou envie direto` :
                arquivoPendente ? `📎 ${arquivoPendente.file.name} — clique em Enviar` :
                'Mensagem para o Atlas...'
              }
              rows={1}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 14, fontFamily: 'inherit', resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', padding: '4px 0' }}
            />
            <button
              onClick={send}
              disabled={loading || uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto)}
              style={{
                padding: '8px 16px', borderRadius: 8,
                background: loading || uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? '#2d3148' : '#4f8ef7',
                color: loading || uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? '#8892a4' : '#fff',
                border: 'none', fontWeight: 600, fontSize: 13,
                cursor: loading || uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? 'not-allowed' : 'pointer',
                flexShrink: 0, transition: 'all .15s'
              }}
            >
              {loading ? '...' : 'Enviar'}
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#2d3148', marginTop: 8 }}>Enter para enviar · Shift+Enter para nova linha · 📎 para enviar arquivo</p>
        </div>
      </div>
    </div>
  )
}