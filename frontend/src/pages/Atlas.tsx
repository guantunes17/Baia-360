import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

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

const MOCK_RESPONSES: Record<string, ((args: any, token: string) => Promise<any>) | ((args: any) => any)> = {
  get_dashboard: async (_args: any, token: string) => {
    const res = await fetch(`${API}/api/atlas/dashboard_data`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return { erro: 'Não foi possível carregar dados do dashboard.' }
    return res.json()
  },
  gerar_relatorio: ({ modulo, mes_ref }: any) => ({ status: 'aguardando_arquivo', modulo, mes_ref, mensagem: `Aguardando arquivo Excel para ${modulo} (${mes_ref}).` }),
  get_agenda: () => ({ eventos: [] }),
  criar_evento: ({ titulo, data, hora_inicio, hora_fim }: any) => ({ status: 'mock', mensagem: `Integração Outlook pendente. Evento "${titulo}" para ${data} das ${hora_inicio} às ${hora_fim} anotado.` })
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
  feedback?: 'up' | 'down'
}

interface ArquivoPendente {
  file: File
  modulo: string
  mes_ref: string
}

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

// ── Ícones SVG ──────────────────────────────────────────────────────────────
const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="8" height="10" rx="1.5"/><path d="M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1"/>
  </svg>
)
const IconRegenerate = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 8A5 5 0 112 8"/><path d="M13 5v3h-3"/>
  </svg>
)
const IconThumbUp = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 9V6a3 3 0 016 0v1h2a1 1 0 01.97 1.24l-1 5A1 1 0 0112 14H6a1 1 0 01-1-1v-4z"/>
    <path d="M5 9H3a1 1 0 00-1 1v3a1 1 0 001 1h2"/>
  </svg>
)
const IconThumbDown = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 7V10a3 3 0 01-6 0V9H3a1 1 0 01-.97-1.24l1-5A1 1 0 014 2h6a1 1 0 011 1v4z"/>
    <path d="M11 7h2a1 1 0 011-1V3a1 1 0 00-1-1h-2"/>
  </svg>
)
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2l3 3-8 8H3v-3l8-8z"/>
  </svg>
)
const IconStop = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <rect x="2" y="2" width="8" height="8" rx="1.5"/>
  </svg>
)
const IconScrollDown = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v10M4 9l4 4 4-4"/>
  </svg>
)

// ── Botão ícone com tooltip ──────────────────────────────────────────────────
function IcBtn({ onClick, tip, children, active, color }: {
  onClick?: () => void
  tip: string
  children: React.ReactNode
  active?: boolean
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      title={tip}
      style={{
        position: 'relative', width: 28, height: 28,
        background: active ? (color === 'green' ? '#10b98122' : color === 'red' ? '#ef444422' : '#1a1d27') : 'none',
        border: 'none', cursor: 'pointer',
        color: active ? (color === 'green' ? '#10b981' : color === 'red' ? '#ef4444' : '#e2e8f0') : '#8892a4',
        borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background .12s, color .12s',
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = '#1a1d27'
          ;(e.currentTarget as HTMLElement).style.color = '#e2e8f0'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = 'none'
          ;(e.currentTarget as HTMLElement).style.color = '#8892a4'
        }
      }}
    >
      {children}
    </button>
  )
}

export function Atlas({ nomeUsuario }: { nomeUsuario: string }) {
  const [conversas, setConversas] = useState<Conversa[]>([novaConversa()])
  const [ativaId, setAtivaId] = useState<string>(() => conversas[0].id)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null)
  const [arquivoPendente, setArquivoPendente] = useState<ArquivoPendente | null>(null)
  const [uploadInfo, setUploadInfo] = useState<{ modulo: string; mes_ref: string } | null>(null)
  const [arquivoContexto, setArquivoContexto] = useState<ArquivoContexto | null>(null)
  const [uploadandoArquivo, setUploadandoArquivo] = useState(false)
  const [editandoIdx, setEditandoIdx] = useState<number | null>(null)
  const [editandoTexto, setEditandoTexto] = useState('')
  const [copiadoIdx, setCopiadoIdx] = useState<number | null>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)
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
- Buscar informações atuais na internet quando necessário (cotações, notícias, dados externos)

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
- Quando o usuário pedir para GERAR um relatório operacional (Pedidos, Fretes, etc.), use a ferramenta gerar_relatorio e informe que um botão aparecerá para enviar o arquivo Excel correspondente

Sobre busca na internet:
- Você TEM acesso à internet via Google Search — nunca diga que não consegue pesquisar
- Use a busca quando o usuário pedir informações atuais: cotações, câmbio, notícias, eventos recentes, dados de mercado
- Use a busca também para complementar respostas sobre logística, regulações, notícias do setor farmacêutico
- Sempre que usar a busca, mencione as fontes encontradas`

  const conversa = conversas.find(c => c.id === ativaId)!

  // ── Scroll to bottom automático ──────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversa?.msgs])

  // ── Detectar se usuário subiu no chat para mostrar botão scroll ──────────
  useEffect(() => {
    const el = chatBodyRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(distFromBottom > 200)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

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

  // ── Stop generation ───────────────────────────────────────────────────────
  const stopGeneration = () => {
    abortCtrl?.abort()
    setLoading(false)
    updateConversa(ativaId, c => {
      const msgs = [...c.msgs]
      const last = msgs[msgs.length - 1]
      if (last?.streaming) {
        msgs[msgs.length - 1] = { ...last, streaming: false, text: last.text || '_(geração interrompida)_' }
      }
      return { ...c, msgs }
    })
  }

  // ── Copiar resposta ───────────────────────────────────────────────────────
  const copiarResposta = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiadoIdx(idx)
    setTimeout(() => setCopiadoIdx(null), 2000)
  }

  // ── Feedback ──────────────────────────────────────────────────────────────
  const darFeedback = (convId: string, idx: number, tipo: 'up' | 'down') => {
    updateConversa(convId, c => {
      const msgs = [...c.msgs]
      msgs[idx] = { ...msgs[idx], feedback: msgs[idx].feedback === tipo ? undefined : tipo }
      return { ...c, msgs }
    })
  }

  // ── Editar mensagem ───────────────────────────────────────────────────────
  const iniciarEdicao = (idx: number, texto: string) => {
    setEditandoIdx(idx)
    setEditandoTexto(texto)
  }

  const confirmarEdicao = async () => {
    if (editandoIdx === null) return
    const texto = editandoTexto.trim()
    if (!texto) return

    // Trunca a conversa até a mensagem editada e reenvía
    updateConversa(ativaId, c => {
      const msgs = c.msgs.slice(0, editandoIdx)
      const history = c.history.slice(0, Math.max(0, editandoIdx - 1))
      return { ...c, msgs, history }
    })
    setEditandoIdx(null)
    setEditandoTexto('')
    setInput(texto)
    setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
  }

  // ── Regenerar última resposta ─────────────────────────────────────────────
  const regenerar = () => {
    const msgs = conversa.msgs
    // Encontra o último par user/assistant
    const lastAssistantIdx = [...msgs].reverse().findIndex(m => m.role === 'assistant')
    if (lastAssistantIdx === -1) return
    const assistantIdx = msgs.length - 1 - lastAssistantIdx
    const userMsg = msgs[assistantIdx - 1]
    if (!userMsg || userMsg.role !== 'user') return

    // Remove a última resposta e reenvía
    updateConversa(ativaId, c => ({
      ...c,
      msgs: c.msgs.slice(0, assistantIdx),
      history: c.history.slice(0, -1)
    }))
    setInput(userMsg.text)
    setTimeout(() => send(), 50)
  }

  // ── Upload arquivo de contexto ────────────────────────────────────────────
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

  // ── Enviar mensagem ───────────────────────────────────────────────────────
  const send = async () => {
    const text = input.trim()
    if (loading) return
    if (!text && !arquivoPendente && !arquivoContexto) return

    setInput('')
    setLoading(true)
    const ctrl = new AbortController()
    setAbortCtrl(ctrl)
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

    // ── Fluxo normal ──
    const ctx = arquivoContexto
    setArquivoContexto(null)

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
        { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal }
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
          const fnResponses = await Promise.all(fnCalls.map(async (p: any) => {
            const fn = p.functionCall
            const handler = MOCK_RESPONSES[fn.name]
            const result = handler ? await handler(fn.args || {}, token) : { erro: 'não implementado' }
            return { functionResponse: { name: fn.name, response: { result } } }
          }))
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
      if (e.name === 'CanceledError' || e.name === 'AbortError') return
      const rawErr = e.response?.data?.erro || e.message || 'Erro desconhecido'
      const errMsg = rawErr === 'cota_gemini'
        ? '⚠️ O limite de requisições do Atlas foi atingido. Tente novamente em alguns minutos.'
        : 'Erro: ' + rawErr
      updateConversa(convId, c => {
        const msgs = [...c.msgs]
        msgs[msgs.length - 1] = { role: 'note', text: errMsg, streaming: false }
        return { ...c, msgs, history: [] }
      })
    }

    setLoading(false)
    setAbortCtrl(null)
    inputRef.current?.focus()
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === 'Escape' && loading) { stopGeneration() }
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

        {/* Botão scroll to bottom */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            title="Ir para o final"
            style={{
              position: 'absolute', bottom: 90, right: 24, zIndex: 10,
              width: 34, height: 34, borderRadius: '50%',
              background: '#1a1d27', border: '1px solid #2d3148',
              color: '#8892a4', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px #0004', transition: 'color .12s, border-color .12s'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#e2e8f0'; (e.currentTarget as HTMLElement).style.borderColor = '#4f8ef7' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8892a4'; (e.currentTarget as HTMLElement).style.borderColor = '#2d3148' }}
          >
            <IconScrollDown />
          </button>
        )}

        <div ref={chatBodyRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 10%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {conversa.msgs.map((m, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              maxWidth: m.role === 'note' ? '100%' : m.role === 'user' ? '70%' : '100%',
              alignSelf: m.role === 'user' ? 'flex-end' : m.role === 'note' ? 'center' : 'flex-start',
              alignItems: m.role === 'user' ? 'flex-end' : m.role === 'note' ? 'center' : 'flex-start',
            }}>

              {/* Tool badges */}
              {m.tools && m.tools.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {m.tools.map(t => (
                    <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#1a1d2799', border: '1px solid #7c3aed55', color: '#7c3aed', fontFamily: 'monospace' }}>{t}</span>
                  ))}
                </div>
              )}

              {/* Mensagem do usuário */}
              {m.role === 'user' && (
                <>
                  {editandoIdx === i ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                      <textarea
                        value={editandoTexto}
                        onChange={e => setEditandoTexto(e.target.value)}
                        autoFocus
                        style={{ background: '#1e2133', border: '1px solid #4f8ef7', borderRadius: 12, color: '#e2e8f0', fontSize: 14, padding: '10px 14px', resize: 'none', minHeight: 80, outline: 'none', fontFamily: 'inherit' }}
                      />
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditandoIdx(null)} style={{ padding: '5px 12px', borderRadius: 7, background: 'none', border: '1px solid #2d3148', color: '#8892a4', fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
                        <button onClick={confirmarEdicao} style={{ padding: '5px 12px', borderRadius: 7, background: '#4f8ef7', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reenviar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ padding: '10px 16px', borderRadius: 18, background: '#1e2133', color: '#e2e8f0', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                        {m.arquivo && <span style={{ fontSize: 12, color: '#8892a4', display: 'block', marginBottom: 4 }}>📎 {m.arquivo.nome}</span>}
                        {m.text.replace(`📎 ${m.arquivo?.nome}\n`, '').replace(`📎 ${m.arquivo?.nome}`, '') || null}
                      </div>
                      {/* Botão editar abaixo da mensagem do usuário */}
                      <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                        <IcBtn onClick={() => iniciarEdicao(i, m.text)} tip="Editar">
                          <IconEdit />
                        </IcBtn>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Mensagem do assistente */}
              {m.role === 'assistant' && (
                <>
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
                        <div style={{ paddingTop: 2 }}>
                          {[85, 65, 75].map((w, j) => (
                            <div key={j} style={{
                              height: 10, borderRadius: 5, background: '#2d3148', marginBottom: 8,
                              width: `${w}%`,
                              animation: `shimmerAtlas 1.4s ease-in-out infinite ${j * 0.2}s`
                            }} />
                          ))}
                          <div style={{ fontSize: 11, fontStyle: 'italic', color: '#8892a4', display: 'flex', alignItems: 'center', gap: 2, marginTop: 2 }}>
                            {m.tools?.includes('get_dashboard') ? 'Buscando KPIs do dashboard'
                              : m.tools?.includes('gerar_relatorio') ? 'Gerando relatório'
                              : m.tools?.includes('get_agenda') ? 'Consultando agenda'
                              : m.tools?.includes('google_search') ? 'Realizando busca na internet'
                              : 'Consultando'}
                            {[0, 1, 2].map(k => (
                              <span key={k} style={{ animation: `fadedot 1.2s ease-in-out infinite ${k * 0.2}s` }}>.</span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => <p style={{ margin: '0 0 8px 0' }}>{children}</p>,
                              strong: ({ children }) => <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>{children}</strong>,
                              ul: ({ children }) => <ul style={{ margin: '4px 0 8px 0', paddingLeft: 20 }}>{children}</ul>,
                              ol: ({ children }) => <ol style={{ margin: '4px 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
                              li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
                              table: ({ children }) => (
                                <div style={{ overflowX: 'auto', margin: '8px 0' }}>
                                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>{children}</table>
                                </div>
                              ),
                              thead: ({ children }) => <thead style={{ background: '#1a1d27' }}>{children}</thead>,
                              th: ({ children }) => <th style={{ padding: '6px 12px', textAlign: 'left', color: '#8892a4', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2d3148' }}>{children}</th>,
                              td: ({ children }) => <td style={{ padding: '6px 12px', color: '#e2e8f0', borderBottom: '0.5px solid #2d3148' }}>{children}</td>,
                              a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: '#4f8ef7', textDecoration: 'underline' }}>{children}</a>,
                              code({ node, className, children, ...props }: any) {
                                const match = /language-(\w+)/.exec(className || '')
                                const inline = !match
                                if (inline) {
                                  return <code style={{ fontFamily: 'monospace', background: '#0f1117', padding: '1px 6px', borderRadius: 4, fontSize: 13, color: '#a78bfa' }} {...props}>{children}</code>
                                }
                                const codeStr = String(children).replace(/\n$/, '')
                                return (
                                  <div style={{ background: '#0a0c14', border: '0.5px solid #2d3148', borderRadius: 8, margin: '8px 0', overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: '#13161f', borderBottom: '0.5px solid #2d3148' }}>
                                      <span style={{ fontSize: 11, color: '#8892a4', fontFamily: 'monospace' }}>{match[1]}</span>
                                      <CopyCodeBtn code={codeStr} />
                                    </div>
                                    <SyntaxHighlighter
                                      style={vscDarkPlus}
                                      language={match[1]}
                                      PreTag="div"
                                      customStyle={{ margin: 0, background: 'transparent', padding: '12px', fontSize: 12 }}
                                    >
                                      {codeStr}
                                    </SyntaxHighlighter>
                                  </div>
                                )
                              }
                            }}
                          >
                            {m.text}
                          </ReactMarkdown>
                          {m.streaming && <span style={{ display: 'inline-block', width: 2, height: 15, background: '#4f8ef7', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s infinite' }} />}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action bar — sempre visível, abaixo da resposta */}
                  {!m.streaming && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 40 }}>
                      <IcBtn onClick={() => copiarResposta(m.text, i)} tip={copiadoIdx === i ? 'Copiado!' : 'Copiar'}>
                        {copiadoIdx === i
                          ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l3 3 7-7"/></svg>
                          : <IconCopy />
                        }
                      </IcBtn>
                      <IcBtn onClick={regenerar} tip="Regenerar resposta">
                        <IconRegenerate />
                      </IcBtn>
                      <div style={{ width: 1, height: 16, background: '#2d3148', margin: '0 2px' }} />
                      <IcBtn
                        onClick={() => darFeedback(ativaId, i, 'up')}
                        tip="Boa resposta"
                        active={m.feedback === 'up'}
                        color="green"
                      >
                        <IconThumbUp />
                      </IcBtn>
                      <IcBtn
                        onClick={() => darFeedback(ativaId, i, 'down')}
                        tip="Resposta ruim"
                        active={m.feedback === 'down'}
                        color="red"
                      >
                        <IconThumbDown />
                      </IcBtn>
                    </div>
                  )}
                </>
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
          @keyframes shimmerAtlas { 0%{opacity:0.4} 50%{opacity:0.8} 100%{opacity:0.4} }
          @keyframes fadedot { 0%,100%{opacity:0.3} 50%{opacity:1} }
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

          {/* Preview arquivo de contexto */}
          {arquivoContexto && (
            <div style={{ marginBottom: 8, padding: '6px 12px', background: '#1a1d27', border: '1px solid #7c3aed33', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#a78bfa' }}>📎 {arquivoContexto.nome}</span>
              <button onClick={() => setArquivoContexto(null)} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file && uploadInfo) setArquivoPendente({ file, modulo: uploadInfo.modulo, mes_ref: uploadInfo.mes_ref })
              e.target.value = ''
            }}
          />
          <input ref={fileContextoRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleArquivoContexto(file)
              e.target.value = ''
            }}
          />

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 12, padding: '8px 8px 8px 12px' }}>
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

            {/* Botão Parar / Enviar */}
            {loading ? (
              <button
                onClick={stopGeneration}
                style={{
                  padding: '7px 14px', borderRadius: 8,
                  background: '#ef444422', color: '#ef4444',
                  border: '1px solid #ef444444',
                  fontWeight: 600, fontSize: 13,
                  cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'all .15s'
                }}
              >
                <IconStop /> Parar
              </button>
            ) : (
              <button
                onClick={send}
                disabled={uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto)}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  background: uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? '#2d3148' : '#4f8ef7',
                  color: uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? '#8892a4' : '#fff',
                  border: 'none', fontWeight: 600, fontSize: 13,
                  cursor: uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? 'not-allowed' : 'pointer',
                  flexShrink: 0, transition: 'all .15s'
                }}
              >
                Enviar
              </button>
            )}
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#2d3148', marginTop: 8 }}>
            Enter para enviar · Shift+Enter para nova linha · Esc para parar geração · 📎 para enviar arquivo
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Botão copiar código ────────────────────────────────────────────────────
function CopyCodeBtn({ code }: { code: string }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = () => {
    navigator.clipboard.writeText(code)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }
  return (
    <button
      onClick={copiar}
      title="Copiar código"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'none', border: 'none', cursor: 'pointer',
        color: copiado ? '#10b981' : '#8892a4', fontSize: 11,
        padding: '2px 6px', borderRadius: 4, transition: 'color .12s'
      }}
      onMouseEnter={e => { if (!copiado) (e.currentTarget as HTMLElement).style.color = '#e2e8f0' }}
      onMouseLeave={e => { if (!copiado) (e.currentTarget as HTMLElement).style.color = '#8892a4' }}
    >
      {copiado
        ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l3 3 7-7"/></svg> Copiado</>
        : <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="8" height="10" rx="1.5"/><path d="M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1"/></svg> Copiar</>
      }
    </button>
  )
}