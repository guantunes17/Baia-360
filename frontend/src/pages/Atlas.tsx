import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { API } from '@/config'

const TOOLS_DEF = [
  { id: 'get_dashboard', name: 'get_dashboard', on: true,
    declaration: { name: 'get_dashboard', description: 'Retorna KPIs e histórico de relatórios gerados. Use quando o usuário perguntar sobre métricas, faturamento, SLA, estoque, ou qualquer dado operacional.', parameters: { type: 'object', properties: { modulo: { type: ['string', 'null'], description: 'Filtrar por módulo específico. Passar null para retornar todos os módulos.' } }, required: ['modulo'] } }
  },
  { id: 'gerar_relatorio', name: 'gerar_relatorio', on: true,
    declaration: { name: 'gerar_relatorio', description: 'Inicia a geração de um relatório para um módulo e mês de referência. Após chamar esta ferramenta, informe ao usuário que ele precisa enviar o arquivo Excel correspondente para continuar.', parameters: { type: 'object', properties: { modulo: { type: 'string', description: 'Nome do módulo: Pedidos, Fretes, Armazenagem, Estoque, Cap. Operacional, Recebimentos, Fat. Distribuição, Fat. Armazenagem' }, mes_ref: { type: 'string', description: 'Mês de referência no formato YYYY-MM. Ex: 2025-03' } }, required: ['modulo', 'mes_ref'] } }
  },
  { id: 'get_agenda', name: 'get_agenda', on: true,
    declaration: { name: 'get_agenda', description: 'Retorna eventos da agenda do usuário no Outlook.', parameters: { type: 'object', properties: { data_inicio: { type: 'string', description: 'Data inicial YYYY-MM-DD' }, data_fim: { type: 'string', description: 'Data final YYYY-MM-DD' } }, required: ['data_inicio', 'data_fim'] } }
  },
  { id: 'criar_evento', name: 'criar_evento', on: true,
    declaration: { name: 'criar_evento', description: 'Cria um novo evento na agenda do Outlook.', parameters: { type: 'object', properties: { titulo: { type: 'string' }, data: { type: 'string', description: 'YYYY-MM-DD' }, hora_inicio: { type: 'string', description: 'HH:MM' }, hora_fim: { type: 'string', description: 'HH:MM' }, descricao: { type: 'string' } }, required: ['titulo', 'data', 'hora_inicio', 'hora_fim', 'descricao'] } }
  },
  { id: 'buscar_conversas', name: 'buscar_conversas', on: true,
    declaration: { name: 'buscar_conversas', description: 'Busca conversas anteriores do usuário com o Atlas. Use quando o usuário pedir para se atualizar, revisar o que foi discutido, ou referenciar algo de conversas passadas.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Palavras-chave para buscar nas conversas. Pode ser vazio para trazer as mais recentes.' } }, required: ['query'] } }
  },
  { id: 'buscar_emails', name: 'buscar_emails', on: true,
    declaration: { name: 'buscar_emails', description: 'Busca e-mails do usuário no Outlook. Use quando o usuário perguntar sobre e-mails, mensagens recebidas, ou quiser encontrar um e-mail específico.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Texto para buscar no assunto ou remetente. Pode ser vazio para trazer os mais recentes.' }, apenas_nao_lidos: { type: 'boolean', description: 'Se true, retorna apenas e-mails não lidos.' }, limite: { type: 'number', description: 'Quantidade máxima de e-mails a retornar. Default 20, máximo 50.' } }, required: ['query', 'apenas_nao_lidos', 'limite'] } }
  },
  { id: 'enviar_email', name: 'enviar_email', on: true,
    declaration: { name: 'enviar_email', description: 'Envia um e-mail pelo Outlook do usuário. Use quando o usuário pedir para enviar, encaminhar ou redigir um e-mail para alguém.', parameters: { type: 'object', properties: { destinatario: { type: 'string', description: 'Endereço de e-mail do destinatário.' }, nome_destinatario: { type: ['string', 'null'], description: 'Nome de exibição do destinatário. Pode ser null.' }, assunto: { type: 'string', description: 'Assunto do e-mail.' }, corpo: { type: 'string', description: 'Corpo do e-mail em texto simples.' } }, required: ['destinatario', 'nome_destinatario', 'assunto', 'corpo'] } }
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
  get_agenda: async ({ data_inicio, data_fim }: any, token: string) => {
    const res = await fetch(`${API}/api/outlook/agenda?data_inicio=${data_inicio}&data_fim=${data_fim}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao buscar agenda.' }
    }
    return data
  },
  criar_evento: async (args: any, token: string) => {
    const res = await fetch(`${API}/api/outlook/evento`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao criar evento.' }
    }
    return data
  },
  buscar_emails: async ({ query, apenas_nao_lidos, limite }: any, token: string) => {
    const params = new URLSearchParams({
      q: query || '',
      nao_lidos: String(apenas_nao_lidos || false),
      limite: String(limite || 20)
    })
    const res = await fetch(`${API}/api/outlook/emails?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao buscar e-mails.' }
    }
    return data
  },
  buscar_conversas: async ({ query }: any, token: string) => {
    const q = encodeURIComponent(query || '')
    const res = await fetch(`${API}/api/atlas/conversas/buscar?q=${q}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return { erro: 'Não foi possível buscar conversas.' }
    return res.json()
  },
  enviar_email: async (args: any, token: string) => {
    const res = await fetch(`${API}/api/outlook/enviar_email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao enviar e-mail.' }
    }
    return data
  }
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
  file_id: string
  nome: string
}

interface Conversa {
  id: string
  titulo: string
  msgs: Msg[]
  history: any[]
  criadaEm: Date
  pinned?: boolean
}

function gerarId() { return Math.random().toString(36).slice(2, 10) }

function novaConversa(): Conversa {
  return {
    id: gerarId(),
    titulo: 'Nova conversa',
    msgs: [{ role: 'note', text: 'Atlas pronto. Como posso ajudar?' }],
    history: [],
    criadaEm: new Date(),
    pinned: false
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

const IconSearch = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4"/><path d="M11 11l3 3"/></svg>
const IconPin = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2l5 5-2 2-2-1-3 3v2H5l-2-2v-2l3-3-1-2z"/><path d="M2 14l3-3"/></svg>
const IconDownload = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v8M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>

// ── Agrupador de conversas por data ───────────────────────────────────────
function agruparConversas(conversas: Conversa[], busca: string) {
  const agora = new Date()
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
  const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1)
  const set7 = new Date(hoje); set7.setDate(set7.getDate() - 7)

  const filtradas = busca.trim()
    ? conversas.filter(c => c.titulo.toLowerCase().includes(busca.toLowerCase()))
    : conversas

  const pinned = filtradas.filter(c => c.pinned)
  const resto = filtradas.filter(c => !c.pinned)

  const grupos: { label: string; items: Conversa[] }[] = []
  if (pinned.length > 0) grupos.push({ label: 'Fixadas', items: pinned })

  const todasHoje = resto.filter(c => new Date(c.criadaEm) >= hoje)
  const todasOntem = resto.filter(c => { const d = new Date(c.criadaEm); return d >= ontem && d < hoje })
  const todas7 = resto.filter(c => { const d = new Date(c.criadaEm); return d >= set7 && d < ontem })
  const maisAntigas = resto.filter(c => new Date(c.criadaEm) < set7)

  if (todasHoje.length > 0) grupos.push({ label: 'Hoje', items: todasHoje })
  if (todasOntem.length > 0) grupos.push({ label: 'Ontem', items: todasOntem })
  if (todas7.length > 0) grupos.push({ label: 'Últimos 7 dias', items: todas7 })
  if (maisAntigas.length > 0) grupos.push({ label: 'Mais antigas', items: maisAntigas })

  return grupos
}

// ── Exportar conversa ─────────────────────────────────────────────────────
function exportarConversa(conversa: Conversa) {
  const linhas = conversa.msgs.map(m => {
    if (m.role === 'user') return `**Você:** ${m.text}`
    if (m.role === 'assistant') return `**Atlas:** ${m.text}`
    return `_${m.text}_`
  })
  const conteudo = `# ${conversa.titulo}\n_${new Date(conversa.criadaEm).toLocaleString('pt-BR')}_\n\n---\n\n${linhas.join('\n\n')}`
  const blob = new Blob([conteudo], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${conversa.titulo.replace(/[^a-z0-9]/gi, '_')}.md`; a.click()
  URL.revokeObjectURL(url)
}

const IconSettings = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>
const IconTokens = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="10" width="3" height="4" rx="1"/><rect x="6.5" y="6" width="3" height="8" rx="1"/><rect x="11" y="2" width="3" height="12" rx="1"/></svg>


// ── Tool Badge melhorado ──────────────────────────────────────────────────
function ToolBadge({ tool }: { tool: string }) {
  const config: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
    get_dashboard: {
      label: 'Dashboard consultado',
      color: '#4f8ef7', bg: '#4f8ef711', border: '#4f8ef733',
      icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><ellipse cx="8" cy="5" rx="6" ry="2.5"/><path d="M2 5v6c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5"/><path d="M2 8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5"/></svg>
    },
    gerar_relatorio: {
      label: 'Relatório gerado',
      color: '#10b981', bg: '#10b98111', border: '#10b98133',
      icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M8 6v4M6 8h4"/></svg>
    },
    google_search: {
      label: 'Pesquisa na web',
      color: '#f0b429', bg: '#f0b42911', border: '#f0b42933',
      icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 2c-2 2-3 4-3 6s1 4 3 6"/><path d="M8 2c2 2 3 4 3 6s-1 4-3 6"/><path d="M2 8h12"/></svg>
    },
    get_agenda: {
      label: 'Agenda consultada',
      color: '#a78bfa', bg: '#7c3aed11', border: '#7c3aed33',
      icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 7h12M5 1v4M11 1v4"/></svg>
    },
    criar_evento: {
      label: 'Evento criado',
      color: '#a78bfa', bg: '#7c3aed11', border: '#7c3aed33',
      icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 7h12M5 1v4M11 1v4M8 10v-2M7 10h2"/></svg>
    },
    buscar_emails: {
      label: 'E-mails consultados',
      color: '#a78bfa', bg: '#7c3aed11', border: '#7c3aed33',
      icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M1 5l7 5 7-5"/></svg>
    },
    enviar_email: {
      label: 'E-mail enviado',
      color: '#34d399', bg: '#34d39911', border: '#34d39933',
      icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2L2 7l5 2 2 5 5-12z"/></svg>
    },
  }
  const c = config[tool] || { label: tool, color: '#8892a4', bg: '#8892a411', border: '#8892a433', icon: null }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 6, background: c.bg, border: `0.5px solid ${c.border}`, color: c.color, marginBottom: 6 }}>
      {c.icon}{c.label}
    </span>
  )
}

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
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [ativaId, setAtivaId] = useState<string | null>(null)
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
  // Grupo 2
  const [busca, setBusca] = useState('')
  const [renomeandoId, setRenomeandoId] = useState<string | null>(null)
  const [renomeTitulo, setRenomeTitulo] = useState('')
  // Grupo 3
  const [painelConfig, setPainelConfig] = useState(false)
  const [modo, setModo] = useState<string>(() => localStorage.getItem('atlas_modo') || 'Padrão')
  const [temperatura, setTemperatura] = useState<number>(() => parseFloat(localStorage.getItem('atlas_temp') || '1.0'))
  const [instrucoes, setInstrucoes] = useState<string>(() => localStorage.getItem('atlas_instrucoes') || '')
  const [memorias, setMemorias] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('atlas_memorias') || '[]') } catch { return [] } })
  const [novaMemoria, setNovaMemoria] = useState('')
  const [tokenCount, setTokenCount] = useState(0)
  const [modeloSelecionado, setModeloSelecionado] = useState<string>(() => localStorage.getItem('atlas_modelo') || 'gpt-5.4-mini')
  const [reasoningEffort, setReasoningEffort] = useState<string>(() => localStorage.getItem('atlas_reasoning') || 'medium')
  const [codeInterpreter, setCodeInterpreter] = useState<boolean>(() => localStorage.getItem('atlas_code_interp') === 'true')
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileContextoRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const token = localStorage.getItem('token') || ''

  // ── Persistência de conversas ─────────────────────────────────────────────
  const salvarConversa = useCallback(async (conv: Conversa) => {
    if (!token) return
    try {
      await fetch(`${API}/api/atlas/conversas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conv_id: conv.id,
          titulo:  conv.titulo,
          msgs:    conv.msgs,
          history: conv.history
        })
      })
    } catch {}
  }, [token])

  const deletarConversaRemota = useCallback(async (conv_id: string) => {
    if (!token) return
    try {
      await fetch(`${API}/api/atlas/conversas/${conv_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch {}
  }, [token])

  // Carrega conversas salvas ao montar — começa na tela home
  useEffect(() => {
    if (!token) return
    fetch(`${API}/api/atlas/conversas`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const convertidas: Conversa[] = data.map((c: any) => ({
            id:       c.conv_id,
            titulo:   c.titulo,
            msgs:     c.msgs,
            history:  c.history,
            criadaEm: new Date(c.criadaEm),
            pinned:   false
          }))
          setConversas(convertidas)
          // Não define ativa — começa na tela home
        }
      })
      .catch(() => {})
  }, [token])

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
- Quando o usuário pedir para GERAR um relatório operacional (Pedidos, Fretes, Armazenagem, Estoque, Cap. Operacional, Recebimentos, Fat. Distribuição, Fat. Armazenagem), use IMEDIATAMENTE a ferramenta gerar_relatorio — nunca diga que não consegue gerar
- Após usar a ferramenta, informe que um botão aparecerá na tela para o usuário enviar o arquivo Excel correspondente
- Gerar relatório e analisar um arquivo são coisas distintas: gerar usa a ferramenta gerar_relatorio; analisar lê um arquivo enviado pelo usuário

Sobre conversas anteriores:
- Você TEM acesso às conversas anteriores do usuário via ferramenta buscar_conversas
- Use essa ferramenta quando o usuário pedir para você se atualizar, revisar o histórico, ou referenciar algo que foi discutido antes
- Após buscar, leia os resumos e responda com base no que foi encontrado

Sobre busca na internet:
- Você TEM acesso à internet via Google Search — nunca diga que não consegue pesquisar
- Use a busca quando o usuário pedir informações atuais: cotações, câmbio, notícias, eventos recentes, dados de mercado
- Use a busca também para complementar respostas sobre logística, regulações, notícias do setor farmacêutico
- Sempre que usar a busca, mencione as fontes encontradas`

  const conversa = conversas.find(c => c.id === ativaId)!

  // Estimar tokens da conversa ativa
  useEffect(() => {
    const texto = conversa?.msgs.map(m => m.text).join(' ') || ''
    setTokenCount(Math.round(texto.length / 4))
  }, [conversa?.msgs])



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

  // Foca no input de rename quando abre
  useEffect(() => {
    if (renomeandoId) setTimeout(() => renameInputRef.current?.focus(), 50)
  }, [renomeandoId])

  // ── Grupo 2: Pin, Rename, Export ─────────────────────────────────────────
  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConversas(prev => prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c))
  }

  const iniciarRename = (c: Conversa, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenomeandoId(c.id)
    setRenomeTitulo(c.titulo)
  }

  const confirmarRename = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!renomeandoId) return
    const titulo = renomeTitulo.trim() || 'Nova conversa'
    setConversas(prev => prev.map(c => c.id === renomeandoId ? { ...c, titulo } : c))
    setRenomeandoId(null)
    setRenomeTitulo('')
  }


  // ── Grupo 3: Configurações ───────────────────────────────────────────────
  const salvarConfig = () => {
    localStorage.setItem('atlas_modo', modo)
    localStorage.setItem('atlas_temp', temperatura.toString())
    localStorage.setItem('atlas_instrucoes', instrucoes)
    localStorage.setItem('atlas_memorias', JSON.stringify(memorias))
    localStorage.setItem('atlas_modelo', modeloSelecionado)
    setPainelConfig(false)
  }

  const adicionarMemoria = () => {
    const mem = novaMemoria.trim()
    if (!mem) return
    const novas = [...memorias, mem]
    setMemorias(novas)
    setNovaMemoria('')
  }

  const removerMemoria = (idx: number) => {
    setMemorias(prev => prev.filter((_, i) => i !== idx))
  }

  const handleRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') confirmarRename()
    if (e.key === 'Escape') { setRenomeandoId(null); setRenomeTitulo('') }
  }

  const updateConversa = useCallback((id: string, fn: (c: Conversa) => Conversa) => {
    setConversas(prev => prev.map(c => c.id === id ? fn(c) : c))
  }, [])

  const criarNovaConversa = () => {
    setAtivaId(null)
    setPreviousResponseId(null)
  }

  const deletarConversa = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deletarConversaRemota(id)
    setConversas(prev => {
      const restantes = prev.filter(c => c.id !== id)
      if (ativaId === id) {
        setTimeout(() => setAtivaId(restantes.length > 0 ? restantes[0].id : null), 0)
      }
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
    updateConversa(ativaId!, c => {
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
    updateConversa(ativaId!, c => {
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
    updateConversa(ativaId!, c => ({
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
      setArquivoContexto({ file_id: data.file_id, nome: data.nome })
    } catch (e: any) {
      addMsgToConversa(ativaId!, { role: 'note', text: 'Erro ao enviar arquivo: ' + e.message })
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

    // Se não há conversa ativa, cria uma nova agora
    let convId = ativaId
    if (!convId) {
      const nova = novaConversa()
      convId = nova.id
      setConversas(prev => [nova, ...prev])
      setAtivaId(nova.id)
      setPreviousResponseId(null)
    }

    const activeTools = TOOLS_DEF.filter(t => t.on).map(t => t.declaration)
    const modoSuffix = modo === 'Resumido' ? '\n\nIMPORTANTE: Seja extremamente conciso, máximo 3 linhas por resposta.'
      : modo === 'Analítico' ? '\n\nIMPORTANTE: Forneça análise detalhada com dados, contexto e implicações.'
      : modo === 'Detalhado' ? '\n\nIMPORTANTE: Seja completo e didático, explique cada ponto com exemplos.'
      : ''
    const instrucoesSuffix = instrucoes.trim() ? `\n\nInstruções do usuário:\n${instrucoes}` : ''
    const memoriasSuffix = memorias.length > 0 ? `\n\nFatos que o usuário quer que você lembre:\n${memorias.map(m => `- ${m}`).join('\n')}` : ''
    const base = {
      model: modeloSelecionado,
      temperature: temperatura,
      system_prompt: SYSTEM_PROMPT + modoSuffix + instrucoesSuffix + memoriasSuffix,
      tools: activeTools,
      reasoning_effort: reasoningEffort,
      code_interpreter: codeInterpreter,
      previous_response_id: previousResponseId
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
      history: [...(c.history ?? []), { role: 'user', parts: ctx
        ? [{ text: userPrompt }, { file_data: { file_id: ctx.file_id } }]
        : [{ text: userPrompt }]
      }]
    }))

    const convAtual = conversas.find(c => c.id === convId)
    const currentHistory = [...(convAtual?.history ?? []), { role: 'user', parts: ctx
      ? [{ text: userPrompt }, { file_data: { file_id: ctx.file_id } }]
      : [{ text: userPrompt }]
    }]

    try {
      const res = await fetch(`${API}/api/atlas/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...base, history: currentHistory }),
        signal: ctrl.signal
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ erro: 'Erro desconhecido' }))
        throw new Error(err.erro || 'Erro na requisição')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamedText = ''
      const fnCallsColetados: { call_id: string; name: string; args: any }[] = []
      let newHistory = [...currentHistory]

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload) continue

          let evt: any
          try { evt = JSON.parse(payload) } catch { continue }

          if (evt.type === 'text_delta') {
            streamedText += evt.delta
            updateConversa(convId, c => {
              const msgs = [...c.msgs]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: streamedText, streaming: true }
              return { ...c, msgs }
            })

          } else if (evt.type === 'function_call') {
            fnCallsColetados.push({ call_id: evt.call_id, name: evt.name, args: evt.args })
            const toolNames = fnCallsColetados.map(f => f.name)
            updateConversa(convId, c => {
              const msgs = [...c.msgs]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: 'Consultando...', streaming: true, tools: toolNames }
              return { ...c, msgs }
            })

          } else if (evt.type === 'done') {
            // Salva response_id para Conversation State (próxima mensagem não precisa mandar histórico)
            if (evt.response_id) setPreviousResponseId(evt.response_id)
            newHistory = [...currentHistory,
              { role: 'model', parts: fnCallsColetados.length > 0
                ? fnCallsColetados.map(f => ({ functionCall: { call_id: f.call_id, name: f.name, args: f.args } }))
                : [{ text: streamedText }]
              }
            ]

            if (fnCallsColetados.length > 0) {
              const gerarCall = fnCallsColetados.find(f => f.name === 'gerar_relatorio')
              const toolNames = fnCallsColetados.map(f => f.name)

              if (gerarCall) {
                const { modulo, mes_ref } = gerarCall.args
                setUploadInfo({ modulo, mes_ref })
                const fnResponses = fnCallsColetados.map(f => ({
                  functionResponse: {
                    call_id: f.call_id,
                    name: f.name,
                    response: { result: { status: 'aguardando_arquivo', mensagem: `Aguardando upload do arquivo Excel para ${modulo} (${mes_ref}).` } }
                  }
                }))
                const h3 = [...newHistory, { role: 'user', parts: fnResponses }]

                // Segunda chamada via SSE para tool_response
                const res2 = await fetch(`${API}/api/atlas/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ ...base, history: h3 })
                })
                const reader2 = res2.body!.getReader()
                let buf2 = '', text2 = ''
                while (true) {
                  const { done: d2, value: v2 } = await reader2.read()
                  if (d2) break
                  buf2 += decoder.decode(v2, { stream: true })
                  const lines2 = buf2.split('\n'); buf2 = lines2.pop() || ''
                  for (const l2 of lines2) {
                    if (!l2.startsWith('data: ')) continue
                    try { const e2 = JSON.parse(l2.slice(6)); if (e2.type === 'done') text2 = e2.text } catch {}
                  }
                }
                updateConversa(convId, c => {
                  const msgs = [...c.msgs]
                  msgs[msgs.length - 1] = {
                    role: 'assistant',
                    text: text2 || `Por favor, envie o arquivo Excel de **${modulo}** usando o botão abaixo.`,
                    tools: toolNames, streaming: false
                  }
                  return { ...c, msgs, history: [...h3, { role: 'model', parts: [{ text: text2 }] }] }
                })

              } else {
                const fnResponses = await Promise.all(fnCallsColetados.map(async f => {
                  const handler = MOCK_RESPONSES[f.name]
                  const result = handler ? await (handler as any)(f.args || {}, token) : { erro: 'não implementado' }
                  return { functionResponse: { call_id: f.call_id, name: f.name, response: { result } } }
                }))
                const h3 = [...newHistory, { role: 'user', parts: fnResponses }]

                const res2 = await fetch(`${API}/api/atlas/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ ...base, history: h3 })
                })
                const reader2 = res2.body!.getReader()
                let buf2 = '', text2 = ''
                while (true) {
                  const { done: d2, value: v2 } = await reader2.read()
                  if (d2) break
                  buf2 += decoder.decode(v2, { stream: true })
                  const lines2 = buf2.split('\n'); buf2 = lines2.pop() || ''
                  for (const l2 of lines2) {
                    if (!l2.startsWith('data: ')) continue
                    try { const e2 = JSON.parse(l2.slice(6)); if (e2.type === 'done') text2 = e2.text } catch {}
                  }
                }
                updateConversa(convId, c => {
                  const msgs = [...c.msgs]
                  msgs[msgs.length - 1] = {
                    role: 'assistant',
                    text: text2 || '(sem resposta)',
                    tools: toolNames, streaming: false
                  }
                  return { ...c, msgs, history: [...h3, { role: 'model', parts: [{ text: text2 }] }] }
                })
              }

            } else {
              updateConversa(convId, c => {
                const msgs = [...c.msgs]
                msgs[msgs.length - 1] = { role: 'assistant', text: streamedText || '(sem resposta)', streaming: false }
                return { ...c, msgs, history: newHistory }
              })
            }
          } else if (evt.type === 'error') {
            throw new Error(evt.message)
          }
        }
      }

    } catch (e: any) {
      if (e.name === 'AbortError') return
      const rawErr = e.message || 'Erro desconhecido'
      const errMsg = rawErr === 'cota_openai'
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
    // Auto-save após cada resposta
    setTimeout(() => {
      setConversas(prev => {
        const conv = prev.find(c => c.id === convId)
        if (conv) salvarConversa(conv)
        return prev
      })
    }, 300)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === 'Escape' && loading) { stopGeneration() }
  }

  const grupos = agruparConversas(conversas, busca)

  // Tela home — exibida quando não há conversa ativa
  const telaHome = !ativaId || !conversa

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>

      {/* Sidebar */}
      <div style={{ width: 240, background: '#13161f', borderRight: '1px solid #2d3148', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

        {/* Busca */}
        <div style={{ padding: '10px 10px 0', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: '#8892a4', pointerEvents: 'none', display: 'flex' }}>
            <IconSearch />
          </div>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar conversas..."
            style={{ width: '100%', background: '#0f1117', border: '0.5px solid #2d3148', borderRadius: 7, padding: '6px 10px 6px 28px', fontSize: 12, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Nova conversa */}
        <div style={{ padding: '8px 10px' }}>
          <button onClick={criarNovaConversa} style={{ width: '100%', padding: '9px 14px', borderRadius: 8, background: '#4f8ef711', border: '1px solid #4f8ef733', color: '#4f8ef7', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <span style={{ fontSize: 16 }}>+</span> Nova conversa
          </button>
        </div>

        {/* Lista agrupada */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
          {grupos.length === 0 && (
            <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: '#8892a455' }}>
              Nenhuma conversa encontrada
            </div>
          )}
          {grupos.map(grupo => (
            <div key={grupo.label}>
              <div style={{ fontSize: 10, fontWeight: 500, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 12px 4px' }}>
                {grupo.label === 'Fixadas' ? '📌 Fixadas' : grupo.label}
              </div>
              {grupo.items.map(c => (
                <div
                  key={c.id}
                  onClick={() => { if (renomeandoId === c.id) return; setAtivaId(c.id); setUploadInfo(null); setArquivoPendente(null); setArquivoContexto(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 10px', borderRadius: 7, margin: '1px 8px', background: c.id === ativaId ? '#1a1d27' : 'transparent', border: c.id === ativaId ? '0.5px solid #2d3148' : '0.5px solid transparent', cursor: 'pointer', position: 'relative' }}
                  onMouseEnter={e => { const btns = (e.currentTarget as HTMLElement).querySelector('.item-actions') as HTMLElement; if (btns) btns.style.opacity = '1' }}
                  onMouseLeave={e => { const btns = (e.currentTarget as HTMLElement).querySelector('.item-actions') as HTMLElement; if (btns) btns.style.opacity = '0' }}
                >
                  {renomeandoId === c.id ? (
                    <>
                      <input
                        ref={renameInputRef}
                        value={renomeTitulo}
                        onChange={e => setRenomeTitulo(e.target.value)}
                        onKeyDown={handleRenameKey}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, background: '#0f1117', border: '0.5px solid #2d3148', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '2px 6px', outline: 'none', fontFamily: 'inherit' }}
                      />
                      <button onClick={confirmarRename} title="Confirmar"
                        style={{ width: 18, height: 18, borderRadius: 4, background: 'none', border: 'none', color: '#8892a4', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color .12s' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#10b981'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#8892a4'}
                      >✓</button>
                    </>
                  ) : (
                    <>
                      <span
                        style={{ flex: 1, fontSize: 12, color: c.id === ativaId ? '#e2e8f0' : '#8892a4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        onDoubleClick={e => iniciarRename(c, e)}
                      >
                        🤖 {c.titulo}
                      </span>
                      <div className="item-actions" style={{ display: 'flex', gap: 1, opacity: 0, transition: 'opacity .12s', flexShrink: 0 }}>
                        <button onClick={e => togglePin(c.id, e)} title={c.pinned ? 'Desafixar' : 'Fixar'}
                          style={{ width: 18, height: 18, borderRadius: 3, background: 'none', border: 'none', color: c.pinned ? '#f0b429' : '#8892a4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <IconPin />
                        </button>
                        <button onClick={e => { e.stopPropagation(); exportarConversa(c) }} title="Exportar conversa"
                          style={{ width: 18, height: 18, borderRadius: 3, background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <IconDownload />
                        </button>
                        <button onClick={e => deletarConversa(c.id, e)} title="Deletar conversa"
                          style={{ width: 18, height: 18, borderRadius: 3, background: 'none', border: 'none', color: '#8892a4', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          ✕
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
          {/* Footer com ícones */}
          <div style={{ padding: '8px 10px', borderTop: '0.5px solid #2d3148', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: '#2d3148' }}>v1.0</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setPainelConfig(v => !v)}
                title="Uso da sessão"
                style={{ width: 28, height: 28, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#8892a4', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s, color .12s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1a1d27'; (e.currentTarget as HTMLElement).style.color = '#e2e8f0' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#8892a4' }}
              ><IconTokens /></button>
              <button
                onClick={() => setPainelConfig(v => !v)}
                title="Configurações"
                style={{ width: 28, height: 28, borderRadius: 6, background: painelConfig ? '#4f8ef711' : 'none', border: 'none', cursor: 'pointer', color: painelConfig ? '#4f8ef7' : '#8892a4', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s, color .12s' }}
                onMouseEnter={e => { if (!painelConfig) { (e.currentTarget as HTMLElement).style.background = '#1a1d27'; (e.currentTarget as HTMLElement).style.color = '#e2e8f0' } }}
                onMouseLeave={e => { if (!painelConfig) { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#8892a4' } }}
              ><IconSettings /></button>
            </div>
          </div>
        </div>
      </div>

      {/* Tela Home, Chat ou Painel de Configurações */}
      {telaHome && !painelConfig ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f1117', padding: '0 10%', gap: 32 }}>

          {/* Logo e saudação */}
          <div style={{ textAlign: 'center' as any, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <svg width="56" height="56" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="11" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" fill="none" />
              <g clipPath="url(#globoClipHome)">
                <ellipse cx="14" cy="14" rx="11" ry="4" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.8" fill="none" />
                <ellipse cx="14" cy="14" rx="5" ry="11" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.8" fill="none" />
                <ellipse cx="14" cy="14" rx="9" ry="11" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="0.6" fill="none" />
              </g>
              <defs><clipPath id="globoClipHome"><circle cx="14" cy="14" r="11" /></clipPath></defs>
            </svg>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
                {(() => {
                  const h = new Date().getHours()
                  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
                  return `${saudacao}, ${nomeUsuario}.`
                })()}
              </div>
              <div style={{ fontSize: 15, color: '#8892a4' }}>Como posso ajudar você hoje?</div>
            </div>
          </div>

          {/* Sugestões rápidas */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as any, justifyContent: 'center', maxWidth: 640 }}>
            {[
              { icon: '📊', texto: 'Como está o desempenho operacional este mês?' },
              { icon: '🌐', texto: 'Qual a cotação do dólar hoje?' },
              { icon: '📋', texto: 'Gerar relatório de Fretes' },
              { icon: '💡', texto: 'Me atualize sobre nossas últimas conversas' },
            ].map(s => (
              <button key={s.texto} onClick={() => { setInput(s.texto); setTimeout(() => inputRef.current?.focus(), 50) }}
                style={{ padding: '10px 16px', borderRadius: 10, background: '#1a1d27', border: '0.5px solid #2d3148', color: '#8892a4', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all .15s', textAlign: 'left' as any }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#4f8ef755'; (e.currentTarget as HTMLElement).style.color = '#e2e8f0' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2d3148'; (e.currentTarget as HTMLElement).style.color = '#8892a4' }}
              >
                <span>{s.icon}</span><span>{s.texto}</span>
              </button>
            ))}
          </div>

          {/* Input centralizado */}
          <div style={{ width: '100%', maxWidth: 680 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 14, padding: '10px 10px 10px 14px' }}>
              <button onClick={() => fileContextoRef.current?.click()} disabled={uploadandoArquivo}
                title="Enviar arquivo para o Atlas analisar"
                style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, background: 'none', border: 'none', color: uploadandoArquivo ? '#4f8ef7' : '#8892a4', cursor: uploadandoArquivo ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, transition: 'color .15s' }}
                onMouseEnter={e => { if (!uploadandoArquivo) (e.currentTarget as HTMLElement).style.color = '#e2e8f0' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = uploadandoArquivo ? '#4f8ef7' : '#8892a4' }}
              >
                {uploadandoArquivo ? '⏳' : '📎'}
              </button>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                placeholder="Mensagem para o Atlas..."
                rows={1}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 14, fontFamily: 'inherit', resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', padding: '6px 0' }}
              />
              <button onClick={send} disabled={uploadandoArquivo || (!input.trim() && !arquivoContexto)}
                style={{ padding: '9px 18px', borderRadius: 9, background: uploadandoArquivo || (!input.trim() && !arquivoContexto) ? '#2d3148' : '#4f8ef7', color: uploadandoArquivo || (!input.trim() && !arquivoContexto) ? '#8892a4' : '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: uploadandoArquivo || (!input.trim() && !arquivoContexto) ? 'not-allowed' : 'pointer', flexShrink: 0, transition: 'all .15s' }}
              >
                Enviar
              </button>
            </div>
            {arquivoContexto && (
              <div style={{ marginTop: 8, padding: '6px 12px', background: '#1a1d27', border: '1px solid #7c3aed33', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#a78bfa' }}>📎 {arquivoContexto.nome}</span>
                <button onClick={() => setArquivoContexto(null)} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            )}
            <p style={{ textAlign: 'center' as any, fontSize: 11, color: '#2d3148', marginTop: 10 }}>
              Enter para enviar · Shift+Enter para nova linha · 📎 para enviar arquivo
            </p>
          </div>
        </div>
      ) : painelConfig ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 10%', background: '#0f1117', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', paddingLeft: 10, borderLeft: '2px solid #4f8ef7', margin: 0 }}>Configurações do Atlas</h2>

          {/* Modo de resposta */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Modo de resposta</div>
            <div style={{ fontSize: 11, color: '#8892a4', marginBottom: 10, lineHeight: 1.5 }}>Define como o Atlas estrutura as respostas por padrão.</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Resumido', 'Padrão', 'Analítico', 'Detalhado'].map(m => (
                <button key={m} onClick={() => setModo(m)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '0.5px solid', background: modo === m ? '#4f8ef722' : 'none', borderColor: modo === m ? '#4f8ef7' : '#2d3148', color: modo === m ? '#4f8ef7' : '#8892a4', transition: 'all .12s' }}>{m}</button>
              ))}
            </div>
          </div>

          {/* Temperatura */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Criatividade das respostas</div>
            <div style={{ fontSize: 11, color: '#8892a4', marginBottom: 10, lineHeight: 1.5 }}>Valores baixos = mais preciso e direto. Valores altos = mais criativo e variado.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#8892a4', minWidth: 52 }}>Preciso</span>
              <input type="range" min="0" max="2" step="0.1" value={temperatura}
                onChange={e => setTemperatura(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: '#4f8ef7' }}
              />
              <span style={{ fontSize: 12, fontWeight: 500, color: '#4f8ef7', minWidth: 28, textAlign: 'right' }}>{temperatura.toFixed(1)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#8892a455' }}>0.0</span>
              <span style={{ fontSize: 10, color: '#8892a455' }}>Criativo</span>
              <span style={{ fontSize: 10, color: '#8892a455' }}>2.0</span>
            </div>
          </div>

          {/* Instruções customizadas */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Instruções personalizadas</div>
            <div style={{ fontSize: 11, color: '#8892a4', marginBottom: 10, lineHeight: 1.5 }}>O Atlas seguirá essas instruções em todas as conversas.</div>
            <textarea
              value={instrucoes}
              onChange={e => setInstrucoes(e.target.value)}
              rows={3}
              placeholder='Ex: "Sempre mencione a fonte quando usar dados externos. Prefiro respostas diretas."'
              style={{ width: '100%', background: '#0f1117', border: '0.5px solid #2d3148', borderRadius: 7, color: '#e2e8f0', fontSize: 12, padding: '8px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' as any }}
            />
          </div>

          {/* Memória explícita */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Memória do Atlas</div>
            <div style={{ fontSize: 11, color: '#8892a4', marginBottom: 10, lineHeight: 1.5 }}>Fatos que o Atlas sempre lembrará sobre você e a operação.</div>
            {memorias.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {memorias.map((mem, idx) => (
                  <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#4f8ef711', border: '0.5px solid #4f8ef733', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: '#4f8ef7' }}>
                    {mem}
                    <button onClick={() => removerMemoria(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4f8ef755', fontSize: 11, lineHeight: 1, padding: 0, transition: 'color .12s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#ef4444'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#4f8ef755'}
                    >✕</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={novaMemoria}
                onChange={e => setNovaMemoria(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') adicionarMemoria() }}
                placeholder='Ex: "Meta de SLA: 95%"'
                style={{ flex: 1, background: '#0f1117', border: '0.5px solid #2d3148', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '5px 8px', outline: 'none', fontFamily: 'inherit' }}
              />
              <button onClick={adicionarMemoria} style={{ padding: '5px 10px', borderRadius: 6, background: '#4f8ef711', border: '0.5px solid #4f8ef733', color: '#4f8ef7', fontSize: 11, cursor: 'pointer' }}>+ Adicionar</button>
            </div>
          </div>

          {/* Contador de tokens */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Uso da sessão atual</div>
            <div style={{ fontSize: 11, color: '#8892a4', marginBottom: 10, lineHeight: 1.5 }}>Estimativa de tokens usados nesta conversa.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#8892a4' }}>Tokens</span>
              <div style={{ flex: 1, height: 4, background: '#2d3148', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: tokenCount > 8000 ? '#ef4444' : tokenCount > 5000 ? '#f0b429' : '#4f8ef7', width: `${Math.min((tokenCount / 10000) * 100, 100)}%`, transition: 'width .3s' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0', minWidth: 90, textAlign: 'right' }}>~{tokenCount.toLocaleString('pt-BR')} / 10.000</span>
            </div>
          </div>

          {/* Seleção de modelo */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Modelo de IA</div>
            <div style={{ fontSize: 11, color: '#8892a4', marginBottom: 10, lineHeight: 1.5 }}>Escolha o modelo usado pelo Atlas. Modelos mais avançados podem ser mais lentos.</div>
            <select
              value={modeloSelecionado}
              onChange={e => setModeloSelecionado(e.target.value)}
              style={{ width: '100%', background: '#0f1117', border: '0.5px solid #2d3148', borderRadius: 7, color: '#e2e8f0', fontSize: 12, padding: '7px 10px', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <option value="gpt-5.4-mini">GPT-5.4 mini — Rápido e eficiente</option>
              <option value="gpt-5.4">GPT-5.4 — Máxima capacidade, mais lento</option>
            </select>
            <div style={{ marginTop: 8, fontSize: 11, color: '#8892a455' }}>GPT-5.4 consome mais créditos. Recomendado: GPT-5.4 mini para uso diário.</div>
          </div>

          {/* Reasoning Effort */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Velocidade vs. Qualidade</div>
            <div style={{ fontSize: 11, color: '#8892a4', marginBottom: 10, lineHeight: 1.5 }}>Controla o esforço de raciocínio do modelo. Maior esforço = respostas mais precisas, porém mais lentas.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { value: 'low', label: '⚡ Rápido', desc: 'Perguntas simples' },
                { value: 'medium', label: '⚖️ Equilibrado', desc: 'Uso geral' },
                { value: 'high', label: '🧠 Profundo', desc: 'Análises complexas' }
              ].map(opt => (
                <button key={opt.value} onClick={() => setReasoningEffort(opt.value)}
                  style={{ flex: 1, padding: '7px 8px', borderRadius: 8, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '0.5px solid', textAlign: 'center' as any,
                    background: reasoningEffort === opt.value ? '#4f8ef722' : 'none',
                    borderColor: reasoningEffort === opt.value ? '#4f8ef7' : '#2d3148',
                    color: reasoningEffort === opt.value ? '#4f8ef7' : '#8892a4', transition: 'all .12s' }}>
                  <div>{opt.label}</div>
                  <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Code Interpreter */}
          <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 2 }}>🐍 Code Interpreter</div>
                <div style={{ fontSize: 11, color: '#8892a4', lineHeight: 1.5 }}>Permite que o Atlas execute código Python para análises, cálculos e geração de gráficos.</div>
              </div>
              <button onClick={() => setCodeInterpreter(v => !v)}
                style={{ flexShrink: 0, width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', transition: 'background .2s',
                  background: codeInterpreter ? '#4f8ef7' : '#2d3148', position: 'relative' as any }}>
                <div style={{ position: 'absolute' as any, top: 3, left: codeInterpreter ? 20 : 4, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .2s' }} />
              </button>
            </div>
          </div>

          <button onClick={() => {
            localStorage.setItem('atlas_modo', modo)
            localStorage.setItem('atlas_temp', temperatura.toString())
            localStorage.setItem('atlas_instrucoes', instrucoes)
            localStorage.setItem('atlas_memorias', JSON.stringify(memorias))
            localStorage.setItem('atlas_modelo', modeloSelecionado)
            localStorage.setItem('atlas_reasoning', reasoningEffort)
            localStorage.setItem('atlas_code_interp', codeInterpreter.toString())
            setPainelConfig(false)
          }} style={{ padding: '9px 20px', borderRadius: 8, background: '#4f8ef7', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}>
            Salvar configurações
          </button>
        </div>
      ) : (
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
                        onClick={() => darFeedback(ativaId!, i, 'up')}
                        tip="Boa resposta"
                        active={m.feedback === 'up'}
                        color="green"
                      >
                        <IconThumbUp />
                      </IcBtn>
                      <IcBtn
                        onClick={() => darFeedback(ativaId!, i, 'down')}
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
      )}
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