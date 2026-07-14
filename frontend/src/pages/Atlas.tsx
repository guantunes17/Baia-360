import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from 'docx'
import { saveAs } from 'file-saver'
import jsPDF from 'jspdf'

import React from 'react'
import { API } from '@/config'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { addRipple } from '@/lib/ripple'

// TOOLS_DEF removido: definições de tools movidas para o backend (segurança).
// MOCK_RESPONSES abaixo usa apenas os nomes das tools para dispatch local.

// Ferramentas side-effectful — não executam automaticamente. O function_call
// primeiro passa por /api/atlas/preparar_acao (token HMAC de curta duração)
// e só é executado de fato depois que o usuário aprova o card de confirmação.
const GATED_TOOLS = new Set([
  'enviar_email', 'teams_enviar_mensagem', 'teams_criar_reuniao',
  'teams_chat_enviar', 'criar_evento', 'deletar_evento',
])

const NOME_AMIGAVEL_TOOL: Record<string, string> = {
  enviar_email:           'Enviar e-mail',
  teams_enviar_mensagem:  'Enviar mensagem no Teams',
  teams_criar_reuniao:    'Criar reunião no Teams',
  teams_chat_enviar:      'Enviar mensagem direta no Teams',
  criar_evento:           'Criar evento na agenda',
  deletar_evento:         'Excluir evento da agenda',
}

function resumoAcao(tool: string, args: any): string {
  const a = args || {}
  const truncar = (s: string, n = 220) => (s && s.length > n ? s.slice(0, n) + '…' : (s || ''))
  switch (tool) {
    case 'enviar_email':
      return `Para: ${a.destinatario}${a.nome_destinatario ? ` (${a.nome_destinatario})` : ''}\nAssunto: ${a.assunto}\n\n${truncar(a.corpo)}`
    case 'teams_enviar_mensagem':
      return `Time: ${a.team_id}  ·  Canal: ${a.channel_id}\n\n${truncar(a.mensagem)}`
    case 'teams_criar_reuniao':
      return `Título: ${a.titulo}\nInício: ${a.inicio}\nFim: ${a.fim}\nParticipantes: ${(a.participantes || []).join(', ') || 'nenhum'}`
    case 'teams_chat_enviar':
      return `Para: ${a.email_destino}\n\n${truncar(a.mensagem)}`
    case 'criar_evento':
      return `Título: ${a.titulo}\nData: ${a.data} · ${a.hora_inicio}–${a.hora_fim}${a.descricao ? `\n${truncar(a.descricao)}` : ''}`
    case 'deletar_evento':
      return `Excluir o evento de id: ${a.evento_id}`
    default:
      return JSON.stringify(a)
  }
}

const MOCK_RESPONSES: Record<string, ((args: any, token: string, confirmToken?: string) => Promise<any>) | ((args: any) => any)> = {
  // get_dashboard removido: resolvida agora no backend (ver /internal/relatorios/dashboard),
  // o modelo nunca emite mais esse function_call para o frontend.
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
  criar_evento: async (args: any, token: string, confirmToken?: string) => {
    const res = await fetch(`${API}/api/outlook/evento`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, token: confirmToken })
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao criar evento.' }
    }
    return data
  },
  deletar_evento: async ({ evento_id }: any, token: string, confirmToken?: string) => {
    const res = await fetch(`${API}/api/outlook/evento/${evento_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: confirmToken })
    })
    const data = await res.json()
    if (!res.ok) return { erro: data.erro || 'Erro ao deletar evento.' }
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
  enviar_email: async (args: any, token: string, confirmToken?: string) => {
    const res = await fetch(`${API}/api/outlook/enviar_email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, token: confirmToken })
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao enviar e-mail.' }
    }
    return data
  },
  teams_listar_times: async (_args: any, token: string) => {
    const res = await fetch(`${API}/api/teams/times`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao listar times.' }
    }
    return data
  },
  teams_listar_canais: async ({ team_id }: any, token: string) => {
    const res = await fetch(`${API}/api/teams/canais?team_id=${team_id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao listar canais.' }
    }
    return data
  },
  teams_enviar_mensagem: async (args: any, token: string, confirmToken?: string) => {
    const res = await fetch(`${API}/api/teams/mensagem`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, token: confirmToken })
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao enviar mensagem.' }
    }
    return data
  },
  teams_criar_reuniao: async (args: any, token: string, confirmToken?: string) => {
    const res = await fetch(`${API}/api/teams/reuniao`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, token: confirmToken })
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao criar reunião no Teams.' }
    }
    // Registra automaticamente na agenda com o link da reunião. Isso é um
    // efeito colateral interno e sempre-ativo da própria criação da reunião
    // (ver system prompt do Atlas: toda reunião do Teams DEVE virar evento),
    // não uma ação separada solicitada pelo modelo — por isso obtemos o
    // token de confirmação dela aqui mesmo, sem exigir um segundo clique:
    // aprovar a reunião já cobre o registro do evento correspondente.
    let agenda_registrada = false
    if (data.ok && data.link_reuniao) {
      try {
        const eventoArgs = {
          titulo:      args.titulo,
          data:        args.inicio.split('T')[0],
          hora_inicio: args.inicio.split('T')[1]?.slice(0, 5) || '00:00',
          hora_fim:    args.fim.split('T')[1]?.slice(0, 5) || '01:00',
          descricao:   `🔗 Link da reunião Teams: ${data.link_reuniao}`
        }
        const prep = await fetch(`${API}/api/atlas/preparar_acao`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'criar_evento', args: eventoArgs })
        })
        if (prep.ok) {
          const prepData = await prep.json()
          await fetch(`${API}/api/outlook/evento`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...eventoArgs, token: prepData.token })
          })
          agenda_registrada = true
        }
      } catch {
        // Agenda falhou mas reunião foi criada — não bloqueia o retorno
      }
    }
    return {
      ok:                data.ok,
      meeting_id:        data.meeting_id,
      titulo:            data.titulo,
      inicio:            data.inicio,
      fim:               data.fim,
      link_reuniao:      data.link_reuniao,
      agenda_registrada,
      instrucao:         'Evento já registrado na agenda do Outlook automaticamente. NÃO chame criar_evento.'
    }
  },
  teams_chat_enviar: async (args: any, token: string, confirmToken?: string) => {
    const res = await fetch(`${API}/api/teams/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, token: confirmToken })
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.nao_conectado) return { erro: 'Outlook não conectado. O usuário precisa conectar o Outlook nas configurações do perfil.' }
      return { erro: data.erro || 'Erro ao enviar mensagem direta.' }
    }
    return data
  },
}

const ENDPOINT_MAP: Record<string, string> = {
  'Pedidos': 'pedidos', 'Fretes': 'fretes', 'Armazenagem': 'armazenagem',
  'Estoque': 'estoque', 'Cap. Operacional': 'cap_operacional',
  'Recebimentos': 'recebimentos', 'Fat. Distribuição': 'fat_dist', 'Fat. Armazenagem': 'fat_arm'
}

interface Artifact {
  type: string
  title: string
  content: string
}

// Detecta e extrai tag <artifact> do texto completo
function parseArtifact(raw: string): { displayText: string; artifact: Artifact | null } {
  const regex = /<artifact\s+type="([^"]+)"\s+title="([^"]+)">([\s\S]*?)<\/artifact>/i
  const match = raw.match(regex)
  if (!match) return { displayText: raw, artifact: null }
  const artifact: Artifact = { type: match[1], title: match[2], content: match[3].trim() }
  const displayText = raw.replace(regex, '').trim()
  return { displayText, artifact }
}

// Citações de file_search do gpt-5.4-mini chegam no texto como spans delimitados
// por codepoints da Private Use Area (invisíveis, só aparecem com repr() no
// backend) — ex.: 'fileciteturn0file0turn0file5'. Nunca
// devem chegar crus na tela; ver backend/app.py (_FILE_CITE_SPAN) para o
// diagnóstico ao vivo que confirmou o formato.
//
// O dígito de turn é \d+ (não travado em "turn0") pelo mesmo motivo do backend:
// citações de um turno anterior (conversas com previous_response_id) usam outro
// número — travar em turn0 deixaria esse span vazando cru na tela, violando o
// requisito de nunca mostrar marcador bruto.
const FILE_CITE_SPAN = /filecite(?:turn\d+file\d+)+/g
const FILE_CITE_HREF_PREFIX = 'atlas-file-citation:'

// Substitui cada span de citação por um link markdown reconhecível (href com
// esquema próprio) na ordem em que aparecem no texto — mesma ordem do array
// file_citations entregue pelo backend no payload 'done', então o índice N
// aqui corresponde a file_citations[N]. Rodada tanto no buffer em streaming
// quanto no texto final: nunca deixa o marcador bruto chegar ao ReactMarkdown.
function injetarPlaceholdersDeCitacao(raw: string): string {
  let n = 0
  return raw.replace(FILE_CITE_SPAN, () => `[•](${FILE_CITE_HREF_PREFIX}${n++})`)
}

// react-markdown sanitiza qualquer URL fora de um allowlist de esquemas
// (http/https/mailto/etc.) trocando-a por "" antes do componente `a` sequer
// rodar — descoberto rodando o parser real: sem isso, o href da citação
// chegava vazio no componente e o link caía no fallback (some com o chip,
// mas o "" também não quebra o requisito de nunca mostrar marcador cru).
// Deixa passar só o nosso esquema interno; delega o resto pro sanitizador
// padrão do react-markdown, sem afrouxar a segurança pra links reais.
function urlTransformComCitacoes(url: string): string {
  if (url.startsWith(FILE_CITE_HREF_PREFIX)) return url
  return defaultUrlTransform(url)
}

// Para copiar/exportar como texto puro (sem chip) — mesmos spans, mas sem
// deixar rastro nenhum (nem o placeholder markdown) no texto copiado.
function removerCitacoesDoTexto(raw: string): string {
  return raw.replace(FILE_CITE_SPAN, '').replace(/[ \t]{2,}/g, ' ')
}

function rotuloCitacaoArquivo(entry: { files: string[] } | undefined): { label: string; title: string } {
  const arquivos = entry?.files || []
  if (arquivos.length === 0) return { label: 'fonte', title: '' }
  if (arquivos.length === 1) {
    const nome = arquivos[0]
    const truncado = nome.length > 28 ? nome.slice(0, 25) + '…' : nome
    return { label: truncado, title: nome }
  }
  return { label: `${arquivos.length} fontes`, title: arquivos.join('\n') }
}

function CitacaoArquivoChip({ entry }: { entry: { files: string[] } | undefined }) {
  const { label, title } = rotuloCitacaoArquivo(entry)
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 10.5, fontWeight: 500, color: T.textMuted,
        background: T.surface2, border: `0.5px solid ${T.border}`,
        borderRadius: 999, padding: '0 6px', margin: '0 2px',
        lineHeight: '16px', verticalAlign: 'middle', cursor: 'default',
        maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M4 1.5h5L12.5 5v9.5a1 1 0 01-1 1h-7.5a1 1 0 01-1-1v-12a1 1 0 011-1z" />
        <path d="M9 1.5V5h3.5" />
      </svg>
      {label}
    </span>
  )
}

interface Msg {
  role: 'user' | 'assistant' | 'note'
  text: string
  tools?: string[]
  streaming?: boolean
  arquivo?: { nome: string }
  feedback?: 'up' | 'down'
  artifact?: Artifact
  reasoning?: string
  reasoningStreaming?: boolean
  citations?: { url: string; title: string }[]
  fileCitations?: { files: string[] }[]
  response_id?: string
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

interface PendingConfirmacao {
  id: string
  convId: string
  tool: string
  args: any
  confirmToken: string
  jti: string
  avisoExterno: boolean
}

interface Conversa {
  id: string
  titulo: string
  msgs: Msg[]
  history: any[]
  criadaEm: Date
  pinned?: boolean
  projetoId?: number | null
  projetoNome?: string | null
}

interface Projeto {
  id: number
  nome: string
  descricao: string
  criadoEm: string
  atualizadoEm: string
  total_conversas?: number
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
    const texto = removerCitacoesDoTexto(m.text)
    if (m.role === 'user') return `**Você:** ${texto}`
    if (m.role === 'assistant') return `**Atlas:** ${texto}`
    return `_${texto}_`
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
        background: active ? (color === 'green' ? `${T.accentGreen}22` : color === 'red' ? `${T.accentRed}22` : 'rgba(14,22,45,0.6)') : 'none',
        border: 'none', cursor: 'pointer',
        color: active ? (color === 'green' ? T.accentGreen : color === 'red' ? T.accentRed : T.text) : T.textMuted,
        borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background .12s, color .12s',
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = 'rgba(14,22,45,0.6)'
          ;(e.currentTarget as HTMLElement).style.color = T.text
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = 'none'
          ;(e.currentTarget as HTMLElement).style.color = T.textMuted
        }
      }}
    >
      {children}
    </button>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

export function Atlas({ nomeUsuario }: { nomeUsuario: string }) {
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [ativaId, setAtivaId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const isMobile = useIsMobile()
  const [sidebarAberta, setSidebarAberta] = useState(false)

  useEffect(() => {
    const handler = () => setSidebarAberta(v => !v)
    window.addEventListener('atlas-toggle-sidebar', handler)
    return () => window.removeEventListener('atlas-toggle-sidebar', handler)
  }, [])
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null)
  const [arquivoPendente, setArquivoPendente] = useState<ArquivoPendente | null>(null)
  const [uploadInfo, setUploadInfo] = useState<{ modulo: string; mes_ref: string } | null>(null)
  const [arquivoContexto, setArquivoContexto] = useState<ArquivoContexto | null>(null)
  const [uploadandoArquivo, setUploadandoArquivo] = useState(false)
  const [editandoIdx, setEditandoIdx] = useState<number | null>(null)
  const [editandoTexto, setEditandoTexto] = useState('')
  const [copiadoIdx, setCopiadoIdx] = useState<number | null>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [painelArtifact, setPainelArtifact] = useState<Artifact | null>(null)
  const [copiadoArtifact, setCopiadoArtifact] = useState(false)
  const [gerandoBriefing, setGerandoBriefing] = useState(false)

  // Grupo 2
  const [busca, setBusca] = useState('')
  const [renomeandoId, setRenomeandoId] = useState<string | null>(null)
  const [renomeTitulo, setRenomeTitulo] = useState('')

  // Grupo 3
  const [painelConfig, setPainelConfig] = useState(false)
  const usoSessaoRef = useRef<HTMLDivElement>(null)
  const [modo, setModo] = useState<string>(() => localStorage.getItem('atlas_modo') || 'Padrão')
  // temperatura, modeloSelecionado e reasoningEffort foram movidos para o backend
  // Fase 4: instrucoes e memorias agora vivem no backend (AtlasInstrucao / AtlasMemoria)
  // em vez de localStorage — carregadas via useEffect abaixo, nunca mais enviadas no
  // corpo de /api/atlas/chat (o servidor as ignoraria de qualquer forma).
  const [instrucoes, setInstrucoes] = useState<string>('')
  const [memorias, setMemorias] = useState<string[]>([])
  const [novaMemoria, setNovaMemoria] = useState('')
  const [tokenCount, setTokenCount] = useState(0)
  // modeloSelecionado e reasoningEffort movidos para o backend (constantes fixas)
  const [codeInterpreter, setCodeInterpreter] = useState<boolean>(() => localStorage.getItem('atlas_code_interp') === 'true')
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null)
  // Gate de confirmação humana (Fase 2): ações side-effectful ficam pendentes
  // aqui até o usuário aprovar/rejeitar pelo card. confirmResolvers guarda o
  // resolve() da Promise que o Promise.all do function_call está aguardando.
  const [pendingConfirmacoes, setPendingConfirmacoes] = useState<PendingConfirmacao[]>([])
  const confirmResolvers = useRef<Record<string, (result: any) => void>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileContextoRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [menuUsuarioAberto, setMenuUsuarioAberto] = useState(false)
  const [menuConvAberto, setMenuConvAberto] = useState<string | null>(null)
  const [telaProjetos, setTelaProjetos] = useState(false)
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [projetoAtivo, setProjetoAtivo] = useState<Projeto | null>(null)
  const [carregandoProjetos, setCarregandoProjetos] = useState(false)
  const [modalNovoProjeto, setModalNovoProjeto] = useState(false)
  const [novoProjNome, setNovoProjNome] = useState('')
  const [novoProjDesc, setNovoProjDesc] = useState('')
  const [salvandoProjeto, setSalvandoProjeto] = useState(false)
  const [modalMoverConversa, setModalMoverConversa] = useState<string | null>(null)
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
          history: conv.history,
          pinada:  conv.pinned ?? false
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

// Carrega memórias do banco ao montar — todas vêm do servidor agora (Fase 4);
// origem='automatica' vira [auto], origem='manual' fica sem prefixo, preservando
// a mesma distinção visual que a UI já usava.
  useEffect(() => {
    if (!token) return
    fetch(`${API}/api/atlas/memorias`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setMemorias(data.map((m: any) => m.origem === 'manual' ? m.conteudo : `[auto] ${m.conteudo}`))
        }
      })
      .catch(() => {})
  }, [token])

  // Carrega instruções personalizadas do banco ao montar (Fase 4 — antes localStorage)
  useEffect(() => {
    if (!token) return
    fetch(`${API}/api/atlas/instrucoes`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => setInstrucoes(data.instrucoes || ''))
      .catch(() => {})
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
            id:        c.conv_id,
            titulo:    c.titulo,
            msgs:      c.msgs,
            history:   c.history,
            criadaEm:  new Date(c.criadaEm),
            pinned:    c.pinada ?? false,
            projetoId: c.projetoId ?? null
          }))
          setConversas(convertidas)
          // Não define ativa — começa na tela home
        }
      })
      .catch(() => {})
  }, [token])

//Fecha menu do usuário e menu de conversa ao clicar fora
  useEffect(() => {
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('[data-menu-usuario]')) setMenuUsuarioAberto(false)
    if (!target.closest('[data-menu-conv]')) setMenuConvAberto(null)
  }
  document.addEventListener('mousedown', handler)
  return () => document.removeEventListener('mousedown', handler)
}, [])

  // SYSTEM_PROMPT movido para o backend — não exposto ao cliente.

  const conversa = conversas.find(c => c.id === ativaId && (projetoAtivo ? c.projetoId === projetoAtivo.id : true)) ?? null

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
  // ── Projetos ────────────────────────────────────────────────────────────────

  const carregarProjetos = async () => {
    setCarregandoProjetos(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API}/api/atlas/projetos`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setProjetos(data)
    } catch (e) {
      console.error('Erro ao carregar projetos:', e)
    } finally {
      setCarregandoProjetos(false)
    }
  }

  const criarProjeto = async () => {
    if (!novoProjNome.trim()) return
    setSalvandoProjeto(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API}/api/atlas/projetos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoProjNome.trim(), descricao: novoProjDesc.trim() })
      })
      const data = await res.json()
      setProjetos(prev => [{ ...data, total_conversas: 0 }, ...prev])
      setModalNovoProjeto(false)
      setNovoProjNome('')
      setNovoProjDesc('')
      entrarNoProjeto({ ...data, total_conversas: 0 })
    } catch (e) {
      console.error('Erro ao criar projeto:', e)
    } finally {
      setSalvandoProjeto(false)
    }
  }

  const deletarProjeto = async (projetoId: number) => {
    const token = localStorage.getItem('token')
    await fetch(`${API}/api/atlas/projetos/${projetoId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    setProjetos(prev => prev.filter(p => p.id !== projetoId))
    if (projetoAtivo?.id === projetoId) {
      setProjetoAtivo(null)
      setTelaProjetos(true)
    }
  }

  const entrarNoProjeto = (projeto: Projeto) => {
    setProjetoAtivo(projeto)
    setTelaProjetos(false)
    setAtivaId(null)
    setPreviousResponseId(null)
  }

  const moverConversaParaProjeto = async (convId: string, projetoId: number | null) => {
    const token = localStorage.getItem('token')
    await fetch(`${API}/api/atlas/conversas/${convId}/projeto`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projeto_id: projetoId })
    })
    setConversas(prev => prev.map(c => c.id === convId ? { ...c, projetoId: projetoId ?? null } : c))
    setModalMoverConversa(null)
    setProjetos(prev => prev.map(p => ({
      ...p,
      total_conversas: projetoId === p.id
        ? (p.total_conversas ?? 0) + 1
        : p.total_conversas
    })))
  }

  // ── Fim Projetos ─────────────────────────────────────────────────────────────

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
    localStorage.setItem('atlas_code_interp', codeInterpreter.toString())
    // Fase 4: instruções persistem no backend, não em localStorage
    fetch(`${API}/api/atlas/instrucoes`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrucoes })
    }).catch(() => {})
    setPainelConfig(false)
  }

  const adicionarMemoria = async () => {
    const mem = novaMemoria.trim()
    if (!mem) return
    try {
      const res = await fetch(`${API}/api/atlas/memorias`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo: mem })
      })
      if (!res.ok) return
      setMemorias(prev => [...prev, mem])
      setNovaMemoria('')
    } catch { /* falha de rede — não adiciona localmente para não recriar o vetor antigo (client-only) */ }
  }

  const removerMemoria = (idx: number) => {
    const mem = memorias[idx]
    setMemorias(prev => prev.filter((_, i) => i !== idx))
    // Memórias manuais agora também são linhas reais em AtlasMemoria (Fase 4) —
    // localiza pelo conteúdo (mesmo padrão já usado para as automáticas) e remove.
    const conteudo = mem.startsWith('[auto] ') ? mem.replace('[auto] ', '') : mem
    fetch(`${API}/api/atlas/memorias`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((data: any[]) => {
        const found = data.find(m => m.conteudo === conteudo)
        if (found) {
          fetch(`${API}/api/atlas/memorias/${found.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          })
        }
      })
      .catch(() => {})
  }

  const handleRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') confirmarRename()
    if (e.key === 'Escape') { setRenomeandoId(null); setRenomeTitulo('') }
  }

  const updateConversa = useCallback((id: string, fn: (c: Conversa) => Conversa) => {
    setConversas(prev => prev.map(c => c.id === id ? fn(c) : c))
  }, [])

  const criarNovaConversa = () => {
    if (projetoAtivo) {
      const nova = { ...novaConversa(), projetoId: projetoAtivo.id }
      setConversas(prev => [nova, ...prev])
      setAtivaId(nova.id)
    } else {
      setAtivaId(null)
    }
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
  const darFeedback = (convId: string, idx: number, novoValor: 'up' | 'down' | undefined, responseId?: string) => {
    updateConversa(convId, c => {
      const msgs = [...c.msgs]
      msgs[idx] = { ...msgs[idx], feedback: novoValor }
      return { ...c, msgs }
    })
    fetch(`${API}/api/atlas/rag_feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ feedback: novoValor ?? null, response_id: responseId ?? null, conv_id: convId })
    }).catch(() => {})
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
    const msgs = conversa?.msgs
    if (!msgs) return
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
  const gerarBriefing = async () => {
    if (gerandoBriefing) return
    setGerandoBriefing(true)

    // Cria conversa se não houver uma ativa (para sair da tela home)
    if (!ativaId) {
      const nova = { ...novaConversa(), titulo: '☀️ Briefing' }
      setConversas(prev => [nova, ...prev])
      setAtivaId(nova.id)
      setPreviousResponseId(null)
    }

    try {
      const res = await fetch(`${API}/api/atlas/briefing`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()

      const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
      const linhas: string[] = [`# ☀️ Briefing — ${hoje}`, '']

      // Agenda
      if (data.outlook_conectado && data.agenda?.eventos?.length > 0) {
        linhas.push('## 📅 Agenda de hoje')
        data.agenda.eventos.forEach((ev: any) => {
          const inicioStr = ev.inicio ? ev.inicio.substring(0, 19) : ''
          const hora = inicioStr ? new Date(inicioStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
          const titulo = ev.titulo || ev.assunto || ev.subject || 'Sem título'
          linhas.push(`- **${hora}** — ${titulo}`)
        })
      } else if (data.outlook_conectado) {
        linhas.push('## 📅 Agenda de hoje')
        linhas.push('- Nenhum evento agendado para hoje.')
      } else {
        linhas.push('## 📅 Agenda de hoje')
        linhas.push('- Outlook não conectado. Conecte na página de Perfil para ver sua agenda.')
      }
      linhas.push('')

      // E-mails
      if (data.outlook_conectado && data.emails?.total > 0) {
        linhas.push(`## 📧 E-mails não lidos (${data.emails.total})`)
        if (data.emails.resumo) {
          linhas.push(data.emails.resumo)
        } else if (data.emails.emails) {
          data.emails.emails.forEach((em: any) => {
            const remetente = em.remetente || em.from?.emailAddress?.name || 'Desconhecido'
            const assunto   = em.assunto   || em.subject || 'Sem assunto'
            linhas.push(`- **${remetente}** — ${assunto}`)
          })
        }
      } else if (data.outlook_conectado) {
        linhas.push('## 📧 E-mails não lidos')
        linhas.push('- Nenhum e-mail não lido. Caixa de entrada limpa! ✅')
      }
      linhas.push('')

      // Pendências (admin)
      if (data.pendentes !== undefined) {
        linhas.push('## 🔔 Pendências')
        linhas.push(data.pendentes > 0
          ? `- **${data.pendentes} usuário(s)** aguardando aprovação de cadastro.`
          : '- Nenhum cadastro pendente de aprovação.')
        linhas.push('')
      }

      // Notícias
      linhas.push('## 📰 Notícias do setor')
      linhas.push(data.noticias)

      setPainelArtifact({
        type: 'briefing',
        title: `Briefing ${new Date().toLocaleDateString('pt-BR')}`,
        content: linhas.join('\n')
      })
    } catch (e) {
      console.error('Erro ao gerar briefing:', e)
    } finally {
      setGerandoBriefing(false)
    }
  }

  // Gate de confirmação humana (Fase 2) — chamado no lugar de executar
  // diretamente um function_call de uma ferramenta side-effectful. Propõe a
  // ação no backend (token HMAC de 5 min amarrado a tool+args+usuário),
  // publica um card de confirmação e devolve uma Promise que só resolve
  // quando o usuário aprova ou rejeita — o Promise.all do handler de
  // function_call espera por ela como espera por qualquer outra chamada.
  const solicitarConfirmacao = useCallback(async (tool: string, args: any, authToken: string, convId: string): Promise<any> => {
    try {
      const res = await fetch(`${API}/api/atlas/preparar_acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ tool, args })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { erro: err.erro || 'Não foi possível preparar a ação para confirmação.' }
      }
      const prep = await res.json()

      return await new Promise(resolve => {
        const id = `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        confirmResolvers.current[id] = resolve
        setPendingConfirmacoes(prev => [...prev, {
          id, convId, tool, args, confirmToken: prep.token, jti: prep.jti, avisoExterno: !!prep.aviso_externo
        }])
      })
    } catch {
      return { erro: 'Falha de rede ao preparar a ação.' }
    }
  }, [])

  // Resolve um card pendente — chamado pelos botões Aprovar/Rejeitar.
  const resolverConfirmacao = useCallback(async (id: string, aprovado: boolean) => {
    const pendente = pendingConfirmacoes.find(p => p.id === id)
    if (!pendente) return
    setPendingConfirmacoes(prev => prev.filter(p => p.id !== id))

    const resolve = confirmResolvers.current[id]
    delete confirmResolvers.current[id]
    if (!resolve) return

    if (!aprovado) {
      fetch(`${API}/api/atlas/recusar_acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jti: pendente.jti })
      }).catch(() => { /* melhor esforço — não bloqueia a rejeição no chat */ })
      resolve({ status: 'cancelado_pelo_usuario', mensagem: 'Ação cancelada pelo usuário.' })
      return
    }

    const handler = MOCK_RESPONSES[pendente.tool]
    let resultado
    try {
      resultado = handler ? await (handler as any)(pendente.args, token, pendente.confirmToken) : { erro: 'não implementado' }
    } catch (e: any) {
      resultado = { erro: `Handler error: ${e.message}` }
    }
    resolve(resultado)
  }, [pendingConfirmacoes, token])

  const send = async () => {
    const text = input.trim()
    if (loading) return
    if (!text && !arquivoPendente && !arquivoContexto) return

    // Detecta pedido de briefing
    if (/briefing.*(hoje|dia)/i.test(text) || /hoje.*briefing/i.test(text)) {
      setInput('')
      gerarBriefing()
      return
    }

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

    // Apenas preferências de UI seguras — model/tools/temperature/system_prompt são fixados no backend.
    // Fase 4: instrucoes/memorias NÃO são mais enviadas aqui — o backend as lê direto
    // do banco (AtlasInstrucao/AtlasMemoria) por usuario_id; o servidor ignoraria de
    // qualquer forma qualquer valor de instrucoes/memorias vindo no corpo da requisição.
    const base = {
      modo,
      projeto_nome:        projetoAtivo?.nome        ?? '',
      projeto_descricao:   projetoAtivo?.descricao   ?? '',
      code_interpreter:    codeInterpreter,
      previous_response_id: previousResponseId,
      conv_id: convId
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
              const downloadUrl = `${API}/api/modulos/download/${job_id}`
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

          if (evt.type === 'reasoning_start') {
            updateConversa(convId, c => {
              const msgs = [...c.msgs]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], reasoning: '', reasoningStreaming: true }
              return { ...c, msgs }
            })

          } else if (evt.type === 'reasoning_delta') {
            updateConversa(convId, c => {
              const msgs = [...c.msgs]
              const last = msgs[msgs.length - 1]
              msgs[msgs.length - 1] = { ...last, reasoning: (last.reasoning || '') + evt.delta, reasoningStreaming: true }
              return { ...c, msgs }
            })

          } else if (evt.type === 'text_delta') {
            streamedText += evt.delta
            const temArtifact = streamedText.includes('<artifact')
            updateConversa(convId, c => {
              const msgs = [...c.msgs]
              msgs[msgs.length - 1] = {
                ...msgs[msgs.length - 1],
                text: temArtifact ? '' : streamedText,
                streaming: true,
                reasoningStreaming: false,
                tools: temArtifact ? ['__artifact__'] : msgs[msgs.length - 1].tools
              }
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
            const citations: { url: string; title: string }[] = evt.citations || []
            const fileCitations: { files: string[] }[] = evt.file_citations || []
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
                  body: JSON.stringify({ ...base, history: h3, previous_response_id: null, store: false })
                })
                const reader2 = res2.body!.getReader()
                let buf2 = '', text2 = '', respId2 = ''
                while (true) {
                  const { done: d2, value: v2 } = await reader2.read()
                  if (d2) break
                  buf2 += decoder.decode(v2, { stream: true })
                  const lines2 = buf2.split('\n'); buf2 = lines2.pop() || ''
                  for (const l2 of lines2) {
                    if (!l2.startsWith('data: ')) continue
                    try { const e2 = JSON.parse(l2.slice(6)); if (e2.type === 'done') { text2 = e2.text; respId2 = e2.response_id || '' } } catch {}
                  }
                }
                updateConversa(convId, c => {
                  const msgs = [...c.msgs]
                  msgs[msgs.length - 1] = {
                    role: 'assistant',
                    text: text2 || `Por favor, envie o arquivo Excel de **${modulo}** usando o botão abaixo.`,
                    tools: toolNames, streaming: false,
                    response_id: respId2 || undefined
                  }
                  return { ...c, msgs, history: [...h3, { role: 'model', parts: [{ text: text2 }] }] }
                })

              } else {
                const fnResponses = await Promise.all(fnCallsColetados.map(async f => {
                  if (GATED_TOOLS.has(f.name)) {
                    const result = await solicitarConfirmacao(f.name, f.args || {}, token, convId)
                    return { functionResponse: { call_id: f.call_id, name: f.name, response: { result } } }
                  }
                  const handler = MOCK_RESPONSES[f.name]
                  let result
                  try {
                    result = handler ? await (handler as any)(f.args || {}, token) : { erro: 'não implementado' }
                  } catch (handlerErr: any) {
                    result = { erro: `Handler error: ${handlerErr.message}` }
                  }
                  return { functionResponse: { call_id: f.call_id, name: f.name, response: { result } } }
                }))
                const h3 = [...newHistory, { role: 'user', parts: fnResponses }]

                const res2 = await fetch(`${API}/api/atlas/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ ...base, history: h3, previous_response_id: null, store: false })
                })
                const reader2 = res2.body!.getReader()
                let buf2 = '', text2 = '', respId2 = ''
                while (true) {
                  const { done: d2, value: v2 } = await reader2.read()
                  if (d2) break
                  buf2 += decoder.decode(v2, { stream: true })
                  const lines2 = buf2.split('\n'); buf2 = lines2.pop() || ''
                  for (const l2 of lines2) {
                    if (!l2.startsWith('data: ')) continue
                    try { const e2 = JSON.parse(l2.slice(6)); if (e2.type === 'done') { text2 = e2.text; respId2 = e2.response_id || '' } } catch {}
                  }
                }
                updateConversa(convId, c => {
                  const msgs = [...c.msgs]
                  msgs[msgs.length - 1] = {
                    role: 'assistant',
                    text: text2 || '(sem resposta)',
                    tools: toolNames, streaming: false,
                    response_id: respId2 || undefined
                  }
                  return { ...c, msgs, history: [...h3, { role: 'model', parts: [{ text: text2 }] }] }
                })
                const parsed2 = parseArtifact(text2 || '')
                if (parsed2.artifact) {
                  updateConversa(convId, c => {
                    const msgs = [...c.msgs]
                    msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: parsed2.displayText, artifact: parsed2.artifact! }
                    return { ...c, msgs }
                  })
                  setPainelArtifact(parsed2.artifact)
                }
              }

            } else {
              const parsed = parseArtifact(streamedText || '')
              // get_dashboard agora é resolvida no backend (nunca chega aqui como
              // function_call) — o servidor informa em tools_used quais tools ele
              // já resolveu, só para o badge "Dashboard consultado" continuar aparecendo.
              const toolsUsados: string[] | undefined = evt.tools_used?.length ? evt.tools_used : undefined
              updateConversa(convId, c => {
                const msgs = [...c.msgs]
                msgs[msgs.length - 1] = {
                  role: 'assistant',
                  text: parsed.displayText || (parsed.artifact ? '' : '(sem resposta)'),
                  streaming: false,
                  artifact: parsed.artifact || undefined,
                  citations: citations.length > 0 ? citations : undefined,
                  fileCitations: fileCitations.length > 0 ? fileCitations : undefined,
                  response_id: evt.response_id || undefined,
                  tools: toolsUsados
                }
                return { ...c, msgs, history: newHistory }
              })
              if (parsed.artifact) setPainelArtifact(parsed.artifact)
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

  const conversasFiltradas = projetoAtivo
    ? conversas.filter(c => c.projetoId === projetoAtivo.id)
    : conversas.filter(c => !c.projetoId)
  const grupos = agruparConversas(conversasFiltradas, busca)

  // Tela home — exibida quando não há conversa ativa
  const telaHome = !ativaId || !conversa

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>

      {/* Overlay mobile */}
      {isMobile && sidebarAberta && (
        <div onClick={() => setSidebarAberta(false)} style={{ position: 'fixed', inset: 0, background: '#0008', zIndex: 40 }} />
      )}

{/* Sidebar */}
      <div style={{
        width: 240, background: 'rgba(6,8,14,0.97)', borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        ...(isMobile ? {
          position: 'fixed', top: 0, left: 0, height: '100%', zIndex: 50,
          transform: sidebarAberta ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
          boxShadow: sidebarAberta ? '4px 0 20px #0006' : 'none'
        } : {})
      }}>

        {/* Header */}
        <div style={{ padding: '12px 12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.85 }}>
              <circle cx="14" cy="14" r="11" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" fill="none"/>
              <g clipPath="url(#globoClipSidebar)">
                <ellipse cx="14" cy="14" rx="11" ry="4" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.8" fill="none"/>
                <ellipse cx="14" cy="14" rx="5" ry="11" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.8" fill="none"/>
                <ellipse cx="14" cy="14" rx="9" ry="11" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="0.6" fill="none"/>
              </g>
              <defs><clipPath id="globoClipSidebar"><circle cx="14" cy="14" r="11"/></clipPath></defs>
            </svg>
            <span style={{ fontSize: 14, fontWeight: 500, color: T.text }}>Atlas</span>
          </div>
          <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>, undefined, 0.2); criarNovaConversa() }} title="Nova conversa"
            style={{ width: 28, height: 28, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s, color .12s', position: 'relative', overflow: 'hidden' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(14,22,45,0.6)'; (e.currentTarget as HTMLElement).style.color = T.text }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = T.textMuted }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l2 2 2-2h1a2 2 0 002-2V4a2 2 0 00-2-2z"/><path d="M8 6v4M6 8h4"/></svg>
          </button>
        </div>       

        {/* Busca + Nav + Lista (visíveis fora da tela de Projetos) */}
        {!telaProjetos && (
          <>
            {/* Busca */}
            <div style={{ padding: '10px 10px 0', position: 'relative', flexShrink: 0 }}>
              <div style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: `${T.textMuted}55`, pointerEvents: 'none', display: 'flex' }}>
                <IconSearch />
              </div>
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder={projetoAtivo ? `Buscar em ${projetoAtivo.nome}...` : 'Buscar conversas...'}
                style={{ width: '100%', background: T.bg, border: `0.5px solid ${T.border}`, borderRadius: 7, padding: '6px 10px 6px 28px', fontSize: 12, color: T.text, outline: 'none', boxSizing: 'border-box' as any }}
              />
            </div>

            {/* Nav — Nova conversa + Projetos (só na visão geral) */}
            {!projetoAtivo && (
              <div style={{ padding: '8px 10px 4px', flexShrink: 0 }}>
                <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); criarNovaConversa() }} style={{ width: '100%', padding: '8px 14px', borderRadius: 8, background: `${T.accentBlue}11`, border: `1px solid ${T.accentBlue}33`, color: T.accentBlue, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 4, position: 'relative', overflow: 'hidden' }}>
                  <span style={{ fontSize: 15 }}>+</span> Nova conversa
                </button>
                <button
                  onClick={() => { setProjetoAtivo(null); setAtivaId(null); setTelaProjetos(true); setPreviousResponseId(null); carregarProjetos() }}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, transition: 'background .12s, color .12s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(14,22,45,0.6)'; (e.currentTarget as HTMLElement).style.color = T.text }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = T.textMuted }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4a1 1 0 011-1h3l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/>
                  </svg>
                  Projetos
                </button>
              </div>
            )}

            {/* Divisor */}
            <div style={{ height: '0.5px', background: T.border, margin: '2px 10px 4px', flexShrink: 0 }} />

            {/* Lista agrupada */}
            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8, scrollbarWidth: 'thin', scrollbarColor: `${T.border} transparent` }}>
              <style>{`
                .atlas-conv-list::-webkit-scrollbar { width: 3px; }
                .atlas-conv-list::-webkit-scrollbar-track { background: transparent; }
                .atlas-conv-list::-webkit-scrollbar-thumb { background: rgba(240,180,41,0.15); border-radius: 99px; }
                .atlas-conv-list::-webkit-scrollbar-thumb:hover { background: rgba(240,180,41,0.25); }
              `}</style>
          <div className="atlas-conv-list" style={{ height: '100%', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${T.border} transparent` }}>
            {grupos.length === 0 && (
              <div style={{ padding: '20px 12px', textAlign: 'center' as any, fontSize: 12, color: `${T.textMuted}55` }}>
                Nenhuma conversa encontrada
              </div>
            )}
            {grupos.map(grupo => (
              <div key={grupo.label}>
                <div style={{ fontSize: 10, fontWeight: 500, color: T.textMuted, textTransform: 'uppercase' as any, letterSpacing: '0.08em', padding: '8px 12px 4px' }}>
                  {grupo.label === 'Fixadas' ? '📌 Fixadas' : grupo.label}
                </div>
                {grupo.items.map(c => (
                  <div
                    key={c.id}
                    onClick={() => { if (renomeandoId === c.id) return; setAtivaId(c.id); setUploadInfo(null); setArquivoPendente(null); setArquivoContexto(null); if (isMobile) setSidebarAberta(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 10px', borderRadius: 7, margin: '1px 8px', background: c.id === ativaId ? 'rgba(14,22,45,0.7)' : 'transparent', border: c.id === ativaId ? `0.5px solid ${T.border}` : '0.5px solid transparent', cursor: 'pointer', position: 'relative' as any }}
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
                          style={{ flex: 1, background: T.bg, border: `0.5px solid ${T.border}`, borderRadius: 4, color: T.text, fontSize: 12, padding: '2px 6px', outline: 'none', fontFamily: 'inherit' }}
                        />
                        <button onClick={confirmarRename} title="Confirmar"
                          style={{ width: 18, height: 18, borderRadius: 4, background: 'none', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color .12s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.accentGreen}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.textMuted}
                        >✓</button>
                      </>
                    ) : (
                      <>
                        <span
                          style={{ flex: 1, fontSize: 12, color: c.id === ativaId ? T.text : T.textMuted, whiteSpace: 'nowrap' as any, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          onDoubleClick={e => iniciarRename(c, e)}
                        >
                          🤖 {c.titulo}
                        </span>
                        <div className="item-actions" style={{ display: 'flex', gap: 1, opacity: 0, transition: 'opacity .12s', flexShrink: 0, position: 'relative' as any }}>
                          <button
                            data-menu-conv={c.id}
                            onClick={e => { e.stopPropagation(); setMenuConvAberto((v: string | null) => v === c.id ? null : c.id) }}
                            style={{ width: 18, height: 18, borderRadius: 3, background: menuConvAberto === c.id ? T.border : 'none', border: 'none', color: menuConvAberto === c.id ? T.text : T.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s, color .12s' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                              <circle cx="8" cy="2.5" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="13.5" r="1.3"/>
                            </svg>
                          </button>
                          {menuConvAberto === c.id && (
                            <div data-menu-conv={c.id} style={{ position: 'absolute' as any, top: 22, right: 0, ...glass(0.98, 20), border: `0.5px solid ${T.border}`, borderRadius: 9, padding: '4px', minWidth: 172, zIndex: 200, boxShadow: neoShadow }}>
                              <button onClick={e => { togglePin(c.id, e); setMenuConvAberto(null) }}
                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: 'none', border: 'none', color: c.pinned ? T.gold : T.text, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' as any }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.border}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                              >
                                <IconPin /> {c.pinned ? 'Desafixar' : 'Fixar'}
                              </button>
                              <button onClick={e => { e.stopPropagation(); iniciarRename(c, e); setMenuConvAberto(null) }}
                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: 'none', border: 'none', color: T.text, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' as any }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.border}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                              >
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-9 9H2v-3z"/></svg> Renomear
                              </button>
                              <button onClick={e => { e.stopPropagation(); exportarConversa(c); setMenuConvAberto(null) }}
                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: 'none', border: 'none', color: T.text, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' as any }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.border}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                              >
                                <IconDownload /> Exportar conversa
                              </button>
                              <div style={{ height: '0.5px', background: T.border, margin: '4px 6px' }} />
                              <button
                                onClick={e => { e.stopPropagation(); setMenuConvAberto(null); setModalMoverConversa(c.id) }}
                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: 'none', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' as any }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.border}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                              >
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4a1 1 0 011-1h3l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/></svg> Mover para projeto
                              </button>
                              <div style={{ height: '0.5px', background: T.border, margin: '4px 6px' }} />
                              <button onClick={e => { deletarConversa(c.id, e); setMenuConvAberto(null) }}
                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: 'none', border: 'none', color: T.accentRed, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' as any }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = `${T.accentRed}11`}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                              >
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h10M8 5V3M6 5v7M10 5v7M4 5l.5 8h7l.5-8"/></svg> Deletar
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
              </div>
            </div>
          </>
        )}

        {/* Footer — perfil + menu */}
        <div style={{ padding: '10px', borderTop: `0.5px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, position: 'relative' as any }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${T.accentBlue}22`, border: `1px solid ${T.accentBlue}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: T.accentBlue, flexShrink: 0 }}>
              {nomeUsuario.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: T.text, fontWeight: 500, whiteSpace: 'nowrap' as any, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
              {nomeUsuario}
            </span>
          </div>
          <div style={{ position: 'relative' as any }}>
            <button
              data-menu-usuario
              onClick={() => setMenuUsuarioAberto((v: boolean) => !v)}
              title="Menu"
              style={{ width: 28, height: 28, borderRadius: 6, background: menuUsuarioAberto ? 'rgba(14,22,45,0.6)' : 'none', border: 'none', cursor: 'pointer', color: menuUsuarioAberto ? T.text : T.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s, color .12s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(14,22,45,0.6)'; (e.currentTarget as HTMLElement).style.color = T.text }}
              onMouseLeave={e => { if (!menuUsuarioAberto) { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = T.textMuted } }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="13" r="1.2"/>
              </svg>
            </button>
            {menuUsuarioAberto && (
              <div data-menu-usuario style={{ position: 'absolute' as any, bottom: 36, right: 0, ...glass(0.98, 20), border: `0.5px solid ${T.border}`, borderRadius: 10, padding: '4px', minWidth: 180, zIndex: 100, boxShadow: neoShadow }}>
                <button onClick={() => { gerarBriefing(); setMenuUsuarioAberto(false) }}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 7, background: 'none', border: 'none', color: T.text, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' as any }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.border}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                >
                  <span style={{ fontSize: 14 }}>{gerandoBriefing ? '⏳' : '☀️'}</span>
                  <span>{gerandoBriefing ? 'Gerando briefing...' : 'Briefing do dia'}</span>
                </button>
                <button onClick={() => {
                  setPainelConfig(true)
                  setAtivaId(null)
                  setMenuUsuarioAberto(false)
                }}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 7, background: 'none', border: 'none', color: T.text, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' as any }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.border}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                >
                  <IconSettings />
                  <span>Configurações</span>
                </button>
                <button onClick={() => {
                  setPainelConfig(true)
                  setAtivaId(null)
                  setMenuUsuarioAberto(false)
                  setTimeout(() => usoSessaoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
                }}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 7, background: 'none', border: 'none', color: T.text, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' as any }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.border}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                >
                  <IconTokens />
                  <span>Uso da sessão</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Página de Projetos */}
      {telaProjetos && !projetoAtivo && (
        <div style={{ flex: 1, background: T.bg, overflowY: 'auto', padding: '48px 10% 48px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {/* Botão voltar */}
            <button onClick={() => { setTelaProjetos(false); setPreviousResponseId(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 13, marginBottom: 24, padding: 0, transition: 'color .12s' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.text}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.textMuted}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4l-6 4 6 4"/></svg>
              Atlas
            </button>
            {/* Header da página */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0 }}>Projetos</h1>
                <p style={{ fontSize: 14, color: T.textMuted, margin: '6px 0 0' }}>Organize suas conversas por contexto e objetivo</p>
              </div>
              <button onClick={() => setModalNovoProjeto(true)}
                style={{ padding: '9px 20px', borderRadius: 9, background: T.accentBlue, border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>
                Novo projeto
              </button>
            </div>

            {carregandoProjetos ? (
              <div style={{ textAlign: 'center' as any, color: T.textMuted, paddingTop: 48 }}>Carregando...</div>
            ) : projetos.length === 0 ? (
              <div style={{ textAlign: 'center' as any, paddingTop: 64, display: 'flex', flexDirection: 'column' as any, alignItems: 'center', gap: 16 }}>
                <svg width="56" height="56" viewBox="0 0 16 16" fill="none" stroke={T.border} strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4a1 1 0 011-1h3l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/></svg>
                <p style={{ fontSize: 15, color: T.textMuted, margin: 0 }}>Nenhum projeto ainda</p>
                <p style={{ fontSize: 13, color: `${T.textMuted}55`, margin: 0, maxWidth: 320 }}>Crie um projeto para organizar conversas relacionadas e dar contexto automático ao Atlas.</p>
                <button onClick={() => setModalNovoProjeto(true)}
                  style={{ marginTop: 8, padding: '9px 24px', borderRadius: 9, background: `${T.accentBlue}11`, border: `1px solid ${T.accentBlue}33`, color: T.accentBlue, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Criar primeiro projeto
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
                {projetos.map(p => (
                  <div key={p.id}
                    onClick={() => entrarNoProjeto(p)}
                    style={{ padding: '20px', borderRadius: 12, ...glass(0.35, 20), border: `0.5px solid ${T.border}`, cursor: 'pointer', transition: 'border-color .15s, transform .15s', position: 'relative' as any, boxShadow: neoShadow }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}55`; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 10 }}>📁</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>{p.nome}</div>
                    {p.descricao && <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5, marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>{p.descricao}</div>}
                    <div style={{ fontSize: 11, color: `${T.textMuted}55` }}>{p.total_conversas ?? 0} conversa{(p.total_conversas ?? 0) !== 1 ? 's' : ''}</div>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm(`Deletar projeto "${p.nome}"?`)) deletarProjeto(p.id) }}
                      style={{ position: 'absolute' as any, top: 12, right: 12, width: 24, height: 24, borderRadius: 6, background: 'none', border: 'none', color: `${T.textMuted}33`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color .12s, background .12s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.accentRed; (e.currentTarget as HTMLElement).style.background = `${T.accentRed}11` }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = `${T.textMuted}33`; (e.currentTarget as HTMLElement).style.background = 'none' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h10M8 5V3M6 5v7M10 5v7M4 5l.5 8h7l.5-8"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Página do Projeto selecionado (home do projeto) */}
      {projetoAtivo && telaHome && !painelConfig && (
        <div style={{ flex: 1, background: T.bg, overflowY: 'auto', padding: '48px 10% 48px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: 32 }}>
              <button onClick={() => { setProjetoAtivo(null); setTelaProjetos(true); setAtivaId(null) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 13, marginBottom: 16, padding: 0, transition: 'color .12s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.text}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.textMuted}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4l-6 4 6 4"/></svg>
                Projetos
              </button>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 24 }}>📁</span>
                    <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0 }}>{projetoAtivo.nome}</h1>
                  </div>
                  {projetoAtivo.descricao && <p style={{ fontSize: 13, color: T.textMuted, margin: 0, lineHeight: 1.6, maxWidth: 520 }}>{projetoAtivo.descricao}</p>}
                </div>
                <button onClick={criarNovaConversa}
                  style={{ padding: '9px 20px', borderRadius: 9, background: T.accentBlue, border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>
                  Nova conversa
                </button>
              </div>
            </div>

            {/* Lista de conversas do projeto */}
            <div>
              <h2 style={{ fontSize: 13, fontWeight: 500, color: T.textMuted, textTransform: 'uppercase' as any, letterSpacing: '0.08em', marginBottom: 12 }}>Conversas</h2>
              {conversasFiltradas.length === 0 ? (
                <div style={{ textAlign: 'center' as any, padding: '48px 0', display: 'flex', flexDirection: 'column' as any, alignItems: 'center', gap: 12 }}>
                  <p style={{ fontSize: 14, color: T.textMuted, margin: 0 }}>Nenhuma conversa neste projeto ainda</p>
                  <p style={{ fontSize: 12, color: `${T.textMuted}55`, margin: 0 }}>Clique em "Nova conversa" para começar</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' as any, gap: 8 }}>
                  {conversasFiltradas.map(c => (
                    <div key={c.id}
                      onClick={() => setAtivaId(c.id)}
                      style={{ padding: '14px 18px', borderRadius: 10, ...glass(0.35, 20), border: `0.5px solid ${T.border}`, cursor: 'pointer', transition: 'border-color .12s', boxShadow: neoShadow }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}55`}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = T.border}
                    >
                      <div style={{ fontSize: 14, fontWeight: 500, color: T.text, marginBottom: 4 }}>🤖 {c.titulo}</div>
                      <div style={{ fontSize: 12, color: T.textMuted }}>{new Date(c.criadaEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tela Home, Chat ou Painel de Configurações */}
      {!telaProjetos && !projetoAtivo && telaHome && !painelConfig ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: T.bg, padding: '0 10%', gap: 32 }}>

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
              <div style={{ fontSize: 26, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                {(() => {
                  const h = new Date().getHours()
                  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
                  return `${saudacao}, ${nomeUsuario}.`
                })()}
              </div>
              <div style={{ fontSize: 15, color: T.textMuted }}>Como posso ajudar você hoje?</div>
            </div>
          </div>

          {/* Sugestões rápidas */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as any, justifyContent: 'center', maxWidth: 640 }}>
            {[
              { icon: '☀️', texto: 'Atlas, me passa o briefing de hoje' },
              { icon: '📊', texto: 'Como está o desempenho operacional este mês?' },
              { icon: '🌐', texto: 'Qual a cotação do dólar hoje?' },
              { icon: '📋', texto: 'Gerar relatório de Fretes' },
              { icon: '💡', texto: 'Me atualize sobre nossas últimas conversas' },
            ].map(s => (
              <button key={s.texto} onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>, T.accentBlue, 0.2); setInput(s.texto); setTimeout(() => inputRef.current?.focus(), 50) }}
                style={{ padding: '10px 16px', borderRadius: 10, ...glass(0.35, 20), border: `0.5px solid ${T.border}`, color: T.textMuted, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all .15s', textAlign: 'left' as any }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}55`; (e.currentTarget as HTMLElement).style.color = T.text }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border; (e.currentTarget as HTMLElement).style.color = T.textMuted }}
              >
                <span>{s.icon}</span><span>{s.texto}</span>
              </button>
            ))}
          </div>

          {/* Input centralizado */}
          <div style={{ width: '100%', maxWidth: 680 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', ...glass(0.5, 20), border: `1px solid ${T.border}`, borderRadius: 14, padding: '10px 10px 10px 14px' }}>
              <button onClick={() => fileContextoRef.current?.click()} disabled={uploadandoArquivo}
                title="Enviar arquivo para o Atlas analisar"
                style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, background: 'none', border: 'none', color: uploadandoArquivo ? T.accentBlue : T.textMuted, cursor: uploadandoArquivo ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, transition: 'color .15s' }}
                onMouseEnter={e => { if (!uploadandoArquivo) (e.currentTarget as HTMLElement).style.color = T.text }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = uploadandoArquivo ? T.accentBlue : T.textMuted }}
              >
                {uploadandoArquivo ? '⏳' : '📎'}
              </button>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                placeholder="Mensagem para o Atlas..."
                rows={1}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: T.text, fontSize: 14, fontFamily: 'inherit', resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', padding: '6px 0' }}
              />
              <button onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); send() }} disabled={uploadandoArquivo || (!input.trim() && !arquivoContexto)}
                style={{ padding: '9px 18px', borderRadius: 9, background: uploadandoArquivo || (!input.trim() && !arquivoContexto) ? T.border : T.accentBlue, color: uploadandoArquivo || (!input.trim() && !arquivoContexto) ? T.textMuted : '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: uploadandoArquivo || (!input.trim() && !arquivoContexto) ? 'not-allowed' : 'pointer', flexShrink: 0, transition: 'all .15s', position: 'relative', overflow: 'hidden' }}
              >
                Enviar
              </button>
            </div>
            {arquivoContexto && (
              <div style={{ marginTop: 8, padding: '6px 12px', ...glass(0.35, 20), border: `1px solid ${T.accentPurple}33`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#a78bfa' }}>📎 {arquivoContexto.nome}</span>
                <button onClick={() => setArquivoContexto(null)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            )}
            <p style={{ textAlign: 'center' as any, fontSize: 11, color: T.textDim, marginTop: 10 }}>
              Enter para enviar · Shift+Enter para nova linha · 📎 para enviar arquivo
            </p>
          </div>
        </div>
      ) : !telaProjetos && painelConfig ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 10%', background: T.bg, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentBlue}`, margin: 0 }}>Configurações do Atlas</h2>

          {/* Modo de resposta */}
          <div style={{ ...glass(0.35, 20), border: `0.5px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: neoShadow }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.text, marginBottom: 4 }}>Modo de resposta</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>Define como o Atlas estrutura as respostas por padrão.</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Resumido', 'Padrão', 'Analítico', 'Detalhado'].map(m => (
                <button key={m} onClick={() => setModo(m)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '0.5px solid', background: modo === m ? `${T.accentBlue}22` : 'none', borderColor: modo === m ? T.accentBlue : T.border, color: modo === m ? T.accentBlue : T.textMuted, transition: 'all .12s' }}>{m}</button>
              ))}
            </div>
          </div>


          {/* Instruções customizadas */}
          <div style={{ ...glass(0.35, 20), border: `0.5px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: neoShadow }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.text, marginBottom: 4 }}>Instruções personalizadas</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>O Atlas seguirá essas instruções em todas as conversas.</div>
            <textarea
              value={instrucoes}
              onChange={e => setInstrucoes(e.target.value)}
              rows={3}
              placeholder='Ex: "Sempre mencione a fonte quando usar dados externos. Prefiro respostas diretas."'
              style={{ width: '100%', background: T.bg, border: `0.5px solid ${T.border}`, borderRadius: 7, color: T.text, fontSize: 12, padding: '8px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' as any }}
            />
          </div>

          {/* Memória explícita */}
          <div style={{ ...glass(0.35, 20), border: `0.5px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: neoShadow }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.text, marginBottom: 4 }}>Memória do Atlas</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>Fatos que o Atlas sempre lembrará sobre você e a operação.</div>

            {/* Memórias automáticas */}
            {memorias.filter(m => m.startsWith('[auto]')).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: T.accentBlue, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Aprendidas automaticamente</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {memorias.filter(m => m.startsWith('[auto]')).map((mem, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: T.bg, border: `0.5px solid ${T.border}`, borderRadius: 6, padding: '5px 10px' }}>
                      <span style={{ fontSize: 11, color: T.textMuted, flex: 1 }}>{mem.replace('[auto] ', '')}</span>
                      <button
                        onClick={() => removerMemoria(memorias.indexOf(mem))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.border, fontSize: 12, padding: '0 0 0 8px', transition: 'color .12s', flexShrink: 0 }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.accentRed}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.border}
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Memórias manuais */}
            {memorias.filter(m => !m.startsWith('[auto]')).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Adicionadas por você</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {memorias.filter(m => !m.startsWith('[auto]')).map((mem, idx) => (
                    <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, background: `${T.accentBlue}11`, border: `0.5px solid ${T.accentBlue}33`, borderRadius: 6, padding: '3px 8px', fontSize: 11, color: T.accentBlue }}>
                      {mem}
                      <button onClick={() => removerMemoria(memorias.indexOf(mem))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: `${T.accentBlue}55`, fontSize: 11, lineHeight: 1, padding: 0, transition: 'color .12s' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.accentRed}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = `${T.accentBlue}55`}
                      >✕</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={novaMemoria}
                onChange={e => setNovaMemoria(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') adicionarMemoria() }}
                placeholder='Ex: "Meta de SLA: 95%"'
                style={{ flex: 1, background: T.bg, border: `0.5px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 12, padding: '5px 8px', outline: 'none', fontFamily: 'inherit' }}
              />
              <button onClick={adicionarMemoria}
                style={{ padding: '5px 12px', borderRadius: 6, background: `${T.accentBlue}11`, border: `0.5px solid ${T.accentBlue}33`, color: T.accentBlue, fontSize: 12, cursor: 'pointer', fontWeight: 500, transition: 'all .12s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}22` }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}11` }}
              >+ Adicionar</button>
            </div>
          </div>    

          {/* Contador de tokens */}
          <div ref={usoSessaoRef} style={{ ...glass(0.35, 20), border: `0.5px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: neoShadow }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.text, marginBottom: 4 }}>Uso da sessão atual</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>Estimativa de tokens usados nesta conversa.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: T.textMuted }}>Tokens</span>
              <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: tokenCount > 8000 ? T.accentRed : tokenCount > 5000 ? T.gold : T.accentBlue, width: `${Math.min((tokenCount / 10000) * 100, 100)}%`, transition: 'width .3s' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: T.text, minWidth: 90, textAlign: 'right' }}>~{tokenCount.toLocaleString('pt-BR')} / 10.000</span>
            </div>
          </div>


          {/* Code Interpreter */}
          <div style={{ ...glass(0.35, 20), border: `0.5px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: neoShadow }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: T.text, marginBottom: 2 }}>🐍 Code Interpreter</div>
                <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>Permite que o Atlas execute código Python para análises, cálculos e geração de gráficos.</div>
              </div>
              <button onClick={() => setCodeInterpreter(v => !v)}
                style={{ flexShrink: 0, width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', transition: 'background .2s',
                  background: codeInterpreter ? T.accentBlue : T.border, position: 'relative' as any }}>
                <div style={{ position: 'absolute' as any, top: 3, left: codeInterpreter ? 20 : 4, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .2s' }} />
              </button>
            </div>
          </div>

          <button onClick={salvarConfig} style={{ padding: '9px 20px', borderRadius: 8, background: T.accentBlue, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}>
            Salvar configurações
          </button>
        </div>
      ) : !telaProjetos && !telaHome ? (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

      {/* ── Área principal do chat ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', transition: 'all .25s' }}>

        {/* Botão scroll to bottom */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            title="Ir para o final"
            style={{
              position: 'absolute', bottom: 90, right: 24, zIndex: 10,
              width: 34, height: 34, borderRadius: '50%',
              ...glass(0.8, 20), border: `1px solid ${T.border}`,
              color: T.textMuted, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: neoShadow, transition: 'color .12s, border-color .12s'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.text; (e.currentTarget as HTMLElement).style.borderColor = T.accentBlue }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.textMuted; (e.currentTarget as HTMLElement).style.borderColor = T.border }}
          >
            <IconScrollDown />
          </button>
        )}

        {projetoAtivo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 0', marginBottom: -8 }}>
            <button onClick={() => { setAtivaId(null); setPreviousResponseId(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: '#8892a455', fontSize: 11, padding: '3px 8px', borderRadius: 6, transition: 'all .12s', borderColor: 'transparent' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#4f8ef7'; (e.currentTarget as HTMLElement).style.background = '#4f8ef711' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8892a455'; (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4l-6 4 6 4"/></svg>
              📁 {projetoAtivo.nome}
            </button>
          </div>
        )}
        <div ref={chatBodyRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 4%' : '24px 10%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(conversa?.msgs ?? []).map((m, i) => (
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
                      {/* Bloco de raciocínio */}
                      {m.reasoning && (
                        <ReasoningBlock
                          reasoning={m.reasoning}
                          streaming={m.reasoningStreaming}
                        />
                      )}
                      {m.streaming && !m.text ? (
                        <div style={{ paddingTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: '#8892a4', fontStyle: 'italic' }}>
                            {m.tools?.includes('__artifact__') ? 'Gerando documento'
                              : m.tools?.includes('get_dashboard') ? 'Buscando KPIs do dashboard'
                              : m.tools?.includes('gerar_relatorio') ? 'Gerando relatório'
                              : m.tools?.includes('get_agenda') ? 'Consultando agenda'
                              : m.tools?.includes('buscar_conversas') ? 'Buscando conversas anteriores'
                              : m.tools?.includes('buscar_emails') ? 'Buscando e-mails'
                              : m.tools?.includes('enviar_email') ? 'Enviando e-mail'
                              : m.tools?.includes('criar_evento') ? 'Criando evento na agenda'
                              : m.tools?.includes('teams_listar_times') ? 'Buscando times do Teams'
                              : m.tools?.includes('teams_listar_canais') ? 'Buscando canais do Teams'
                              : m.tools?.includes('teams_enviar_mensagem') ? 'Enviando mensagem no Teams'
                              : m.tools?.includes('teams_criar_reuniao') ? 'Criando reunião no Teams'
                              : m.tools?.includes('teams_chat_enviar') ? 'Enviando mensagem direta no Teams'
                              : m.tools?.includes('google_search') ? 'Pesquisando na web'
                              : 'Pensando'}
                          </span>
                          <span style={{ display: 'flex', gap: 2 }}>
                            {[0, 1, 2].map(k => (
                              <span key={k} style={{ width: 3, height: 3, borderRadius: '50%', background: '#8892a4', display: 'inline-block', animation: `fadedot 1.2s ease-in-out infinite ${k * 0.2}s` }} />
                            ))}
                          </span>
                        </div>
                      ) : (
                        <div>
                          <ReactMarkdown
                            urlTransform={urlTransformComCitacoes}
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
                              a: ({ href, children }) => {
                                if (href?.startsWith(FILE_CITE_HREF_PREFIX)) {
                                  const idx = parseInt(href.slice(FILE_CITE_HREF_PREFIX.length), 10)
                                  return <CitacaoArquivoChip entry={m.fileCitations?.[idx]} />
                                }
                                return <a href={href} target="_blank" rel="noreferrer" style={{ color: '#4f8ef7', textDecoration: 'underline' }}>{children}</a>
                              },
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
                            {injetarPlaceholdersDeCitacao(m.text)}
                          </ReactMarkdown>
                          {m.streaming && <span style={{ display: 'inline-block', width: 2, height: 15, background: '#4f8ef7', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s infinite' }} />}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Rodapé de citações */}
                  {!m.streaming && m.citations && m.citations.length > 0 && (
                    <div style={{ marginTop: 8, marginLeft: 40, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 10, color: '#2d3148', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Fontes</div>
                      {m.citations.map((cit, idx) => (
                        <a key={idx} href={cit.url} target="_blank" rel="noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8892a4', textDecoration: 'none', transition: 'color .12s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#4f8ef7' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8892a4' }}
                        >
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9"/><path d="M13 1h2v2m0-2L8 8"/>
                          </svg>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 400 }}>{cit.title || cit.url}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Action bar — sempre visível, abaixo da resposta */}
                  {!m.streaming && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 40 }}>
                      <IcBtn onClick={() => copiarResposta(removerCitacoesDoTexto(m.text), i)} tip={copiadoIdx === i ? 'Copiado!' : 'Copiar'}>
                        {copiadoIdx === i
                          ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l3 3 7-7"/></svg>
                          : <IconCopy />
                        }
                      </IcBtn>
                      <IcBtn onClick={regenerar} tip="Regenerar resposta">
                        <IconRegenerate />
                      </IcBtn>
                      {m.artifact && (
                        <>
                          <div style={{ width: 1, height: 16, background: '#2d3148', margin: '0 2px' }} />
                          <button
                            onClick={() => setPainelArtifact(m.artifact!)}
                            title="Ver documento gerado"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '3px 10px', borderRadius: 6,
                              background: painelArtifact?.title === m.artifact.title ? '#4f8ef722' : '#1a1d27',
                              border: '1px solid',
                              borderColor: painelArtifact?.title === m.artifact.title ? '#4f8ef7' : '#2d3148',
                              color: painelArtifact?.title === m.artifact.title ? '#4f8ef7' : '#8892a4',
                              fontSize: 11, fontWeight: 500, cursor: 'pointer',
                              transition: 'all .15s'
                            }}
                            onMouseEnter={e => {
                              if (painelArtifact?.title !== m.artifact?.title) {
                                (e.currentTarget as HTMLElement).style.borderColor = '#4f8ef755'
                                ;(e.currentTarget as HTMLElement).style.color = '#e2e8f0'
                              }
                            }}
                            onMouseLeave={e => {
                              if (painelArtifact?.title !== m.artifact?.title) {
                                (e.currentTarget as HTMLElement).style.borderColor = '#2d3148'
                                ;(e.currentTarget as HTMLElement).style.color = '#8892a4'
                              }
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="2" width="10" height="12" rx="1.5"/>
                              <path d="M6 6h4M6 9h4M6 12h2"/>
                            </svg>
                            {m.artifact.title}
                          </button>
                        </>
                      )}
                      <div style={{ width: 1, height: 16, background: '#2d3148', margin: '0 2px' }} />
                      <IcBtn
                        onClick={() => darFeedback(ativaId!, i, m.feedback === 'up' ? undefined : 'up', m.response_id)}
                        tip="Boa resposta"
                        active={m.feedback === 'up'}
                        color="green"
                      >
                        <IconThumbUp />
                      </IcBtn>
                      <IcBtn
                        onClick={() => darFeedback(ativaId!, i, m.feedback === 'down' ? undefined : 'down', m.response_id)}
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

        <div style={{ padding: '16px 10%', borderTop: `1px solid ${T.border}`, background: T.bg }}>

          {/* Cards de confirmação de ação (Fase 2 — gate humano) */}
          {pendingConfirmacoes.filter(p => p.convId === ativaId).map(p => (
            <div key={p.id} style={{
              marginBottom: 10, padding: '12px 16px', ...glass(0.5, 20),
              border: `1px solid ${p.avisoExterno ? `${T.accentAmber}55` : T.border}`,
              borderRadius: 10
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                🔒 Confirmação necessária — {NOME_AMIGAVEL_TOOL[p.tool] || p.tool}
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, whiteSpace: 'pre-wrap', marginBottom: 10, lineHeight: 1.5 }}>
                {resumoAcao(p.tool, p.args)}
              </div>
              {p.avisoExterno && (
                <div style={{ fontSize: 11, color: T.accentAmber, marginBottom: 8 }}>
                  ⚠️ Destinatário externo à empresa.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => resolverConfirmacao(p.id, true)}
                  style={{ padding: '6px 16px', borderRadius: 6, background: `${T.accentBlue}22`, border: `1px solid ${T.accentBlue}55`, color: T.accentBlue, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Aprovar
                </button>
                <button
                  onClick={() => resolverConfirmacao(p.id, false)}
                  style={{ padding: '6px 16px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}`, color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Rejeitar
                </button>
              </div>
            </div>
          ))}

          {/* Banner upload para geração de relatório */}
          {uploadInfo && (
            <div style={{ marginBottom: 10, padding: '10px 16px', ...glass(0.5, 20), border: `1px solid ${T.accentBlue}33`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13, color: T.textMuted }}>
                📎 Envie o arquivo Excel de <strong style={{ color: T.text }}>{uploadInfo.modulo}</strong> ({uploadInfo.mes_ref})
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => fileInputRef.current?.click()} style={{ padding: '5px 14px', borderRadius: 6, background: T.accentBlue, color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Selecionar arquivo
                </button>
                <button onClick={() => { setUploadInfo(null); setArquivoPendente(null) }} style={{ padding: '5px 10px', borderRadius: 6, background: 'none', color: T.textMuted, border: `1px solid ${T.border}`, fontSize: 12, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Preview arquivo de contexto */}
          {arquivoContexto && (
            <div style={{ marginBottom: 8, padding: '6px 12px', ...glass(0.35, 20), border: `1px solid ${T.accentPurple}33`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#a78bfa' }}>📎 {arquivoContexto.nome}</span>
              <button onClick={() => setArquivoContexto(null)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 12 }}>✕</button>
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

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', ...glass(0.5, 20), border: `1px solid ${T.border}`, borderRadius: 12, padding: '8px 8px 8px 12px' }}>
            <button
              onClick={() => fileContextoRef.current?.click()}
              disabled={loading || uploadandoArquivo || !!uploadInfo}
              title="Enviar arquivo para o Atlas analisar"
              style={{
                flexShrink: 0, width: 32, height: 32, borderRadius: 8,
                background: 'none', border: 'none',
                color: uploadandoArquivo ? T.accentBlue : T.textMuted,
                cursor: loading || uploadandoArquivo || !!uploadInfo ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, opacity: uploadInfo ? 0.3 : 1, transition: 'color .15s'
              }}
              onMouseEnter={e => { if (!loading && !uploadandoArquivo && !uploadInfo) (e.currentTarget as HTMLElement).style.color = T.text }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = uploadandoArquivo ? T.accentBlue : T.textMuted }}
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
                arquivoPendente ? `📎 ${arquivoPendente.file?.name} — clique em Enviar` :
                'Mensagem para o Atlas...'
              }
              rows={1}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: T.text, fontSize: 14, fontFamily: 'inherit', resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', padding: '4px 0' }}
            />

            {/* Botão Parar / Enviar */}
            {loading ? (
              <button
                onClick={stopGeneration}
                style={{
                  padding: '7px 14px', borderRadius: 8,
                  background: `${T.accentRed}22`, color: T.accentRed,
                  border: `1px solid ${T.accentRed}44`,
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
                onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); send() }}
                disabled={uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto)}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  background: uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? T.border : T.accentBlue,
                  color: uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? T.textMuted : '#fff',
                  border: 'none', fontWeight: 600, fontSize: 13,
                  cursor: uploadandoArquivo || (!input.trim() && !arquivoPendente && !arquivoContexto) ? 'not-allowed' : 'pointer',
                  flexShrink: 0, transition: 'all .15s', position: 'relative', overflow: 'hidden'
                }}
              >
                Enviar
              </button>
            )}
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: T.textDim, marginTop: 8 }}>
            Enter para enviar · Shift+Enter para nova linha · Esc para parar geração · 📎 para enviar arquivo
          </p>
        </div>
      </div>

      {/* ── Painel lateral de artefatos ── */}
      {painelArtifact && (
        <PainelArtifact
          artifact={painelArtifact}
          copiado={copiadoArtifact}
          onCopiar={() => {
            navigator.clipboard.writeText(painelArtifact.content)
            setCopiadoArtifact(true)
            setTimeout(() => setCopiadoArtifact(false), 2000)
          }}
          onBaixar={() => baixarDocx(painelArtifact)}
          onFechar={() => setPainelArtifact(null)}
        />
      )}

      </div>
      ) : null}

      {/* Modal — Novo Projeto */}
      {modalNovoProjeto && (
        <div style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setModalNovoProjeto(false)}>
          <div onClick={e => e.stopPropagation()} style={{ ...glass(0.98, 30), border: `0.5px solid ${T.border}`, borderRadius: 14, padding: '24px', width: 360, boxShadow: neoShadow, display: 'flex', flexDirection: 'column' as any, gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Novo projeto</div>
            <div style={{ display: 'flex', flexDirection: 'column' as any, gap: 6 }}>
              <label style={{ fontSize: 11, color: T.textMuted, fontWeight: 500 }}>NOME</label>
              <input
                autoFocus
                value={novoProjNome}
                onChange={e => setNovoProjNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') criarProjeto() }}
                placeholder="Ex: Integração Kensys WMS"
                style={{ background: T.bg, border: `0.5px solid ${T.border}`, borderRadius: 7, padding: '8px 12px', fontSize: 13, color: T.text, outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as any, gap: 6 }}>
              <label style={{ fontSize: 11, color: T.textMuted, fontWeight: 500 }}>CONTEXTO <span style={{ color: `${T.textMuted}55` }}>(opcional)</span></label>
              <textarea
                value={novoProjDesc}
                onChange={e => setNovoProjDesc(e.target.value)}
                placeholder="Descreva o objetivo ou contexto deste projeto para o Atlas..."
                rows={3}
                style={{ background: T.bg, border: `0.5px solid ${T.border}`, borderRadius: 7, padding: '8px 12px', fontSize: 13, color: T.text, outline: 'none', resize: 'none' as any, fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalNovoProjeto(false)}
                style={{ padding: '7px 16px', borderRadius: 7, background: 'none', border: `0.5px solid ${T.border}`, color: T.textMuted, fontSize: 13, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={criarProjeto} disabled={salvandoProjeto || !novoProjNome.trim()}
                style={{ padding: '7px 16px', borderRadius: 7, background: T.accentBlue, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: novoProjNome.trim() ? 'pointer' : 'not-allowed', opacity: novoProjNome.trim() ? 1 : 0.5 }}>
                {salvandoProjeto ? 'Criando...' : 'Criar projeto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — Mover conversa para projeto */}
      {modalMoverConversa && (
        <div style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setModalMoverConversa(null)}>
          <div onClick={e => e.stopPropagation()} style={{ ...glass(0.98, 30), border: `0.5px solid ${T.border}`, borderRadius: 14, padding: '20px', width: 320, boxShadow: neoShadow, display: 'flex', flexDirection: 'column' as any, gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Mover para projeto</div>
            {projetos.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, padding: '8px 0' }}>Nenhum projeto criado ainda.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' as any, gap: 4 }}>
                {projetos.map(p => (
                  <button key={p.id} onClick={() => moverConversaParaProjeto(modalMoverConversa, p.id)}
                    style={{ padding: '8px 12px', borderRadius: 7, background: 'none', border: `0.5px solid ${T.border}`, color: T.text, fontSize: 13, cursor: 'pointer', textAlign: 'left' as any, transition: 'background .12s, border-color .12s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.border; (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}55` }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.borderColor = T.border }}
                  >
                    <div style={{ fontWeight: 500 }}>{p.nome}</div>
                    {p.descricao && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{p.descricao}</div>}
                  </button>
                ))}
                <button onClick={() => moverConversaParaProjeto(modalMoverConversa, null)}
                  style={{ padding: '7px 12px', borderRadius: 7, background: 'none', border: `0.5px dashed ${T.border}`, color: T.textMuted, fontSize: 12, cursor: 'pointer', textAlign: 'left' as any, marginTop: 2 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.text}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.textMuted}
                >
                  Remover de projeto
                </button>
              </div>
            )}
            <button onClick={() => setModalMoverConversa(null)}
              style={{ padding: '6px', borderRadius: 7, background: 'none', border: 'none', color: `${T.textMuted}55`, fontSize: 12, cursor: 'pointer', alignSelf: 'center' as any }}>
              Cancelar
            </button>
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

// ── Gerador de .docx ───────────────────────────────────────────────────────
async function baixarDocx(artifact: Artifact) {
  const linhas = artifact.content.split('\n')
  const children: Paragraph[] = []

  for (const linha of linhas) {
    const trimmed = linha.trimEnd()

    if (trimmed.startsWith('### ')) {
      children.push(new Paragraph({
        text: trimmed.slice(4),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 }
      }))
    } else if (trimmed.startsWith('## ')) {
      children.push(new Paragraph({
        text: trimmed.slice(3),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 120 }
      }))
    } else if (trimmed.startsWith('# ')) {
      children.push(new Paragraph({
        text: trimmed.slice(2),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 160 }
      }))
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      children.push(new Paragraph({
        text: trimmed.slice(2),
        bullet: { level: 0 },
        spacing: { after: 60 }
      }))
    } else if (/^\d+\.\s/.test(trimmed)) {
      children.push(new Paragraph({
        text: trimmed.replace(/^\d+\.\s/, ''),
        numbering: { reference: 'default-numbering', level: 0 },
        spacing: { after: 60 }
      }))
    } else if (trimmed === '' || trimmed === '---') {
      children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
    } else {
      // Processa bold (**texto**) inline
      const partes = trimmed.split(/(\*\*[^*]+\*\*)/)
      const runs = partes.map(p => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return new TextRun({ text: p.slice(2, -2), bold: true })
        }
        return new TextRun({ text: p })
      })
      children.push(new Paragraph({ children: runs, spacing: { after: 80 } }))
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }]
      }]
    },
    sections: [{ properties: {}, children }]
  })

  const blob = await Packer.toBlob(doc)
  const nomeArquivo = artifact.title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    + '.docx'
  saveAs(blob, nomeArquivo)
}

// ── Gerador de .pdf ────────────────────────────────────────────────────────
async function baixarPdf(artifact: Artifact) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const marginX   = 50
  const largura   = doc.internal.pageSize.getWidth() - marginX * 2
  let y = 60

  const saltarLinha = (extra = 0) => {
    y += extra
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage()
      y = 60
    }
  }

  const linhas = artifact.content.split('\n')

  for (const linha of linhas) {
    const trimmed = linha.trimEnd()

    if (trimmed.startsWith('# ')) {
      saltarLinha(10)
      doc.setFontSize(18).setFont('helvetica', 'bold')
      const wrapped = doc.splitTextToSize(trimmed.slice(2), largura)
      doc.text(wrapped, marginX, y)
      y += wrapped.length * 22 + 8
      // linha separadora
      doc.setDrawColor(79, 142, 247).setLineWidth(0.8)
      doc.line(marginX, y, marginX + largura, y)
      y += 12
      doc.setDrawColor(0)

    } else if (trimmed.startsWith('## ')) {
      saltarLinha(8)
      doc.setFontSize(14).setFont('helvetica', 'bold')
      const wrapped = doc.splitTextToSize(trimmed.slice(3), largura)
      doc.text(wrapped, marginX, y)
      y += wrapped.length * 18 + 6

    } else if (trimmed.startsWith('### ')) {
      saltarLinha(6)
      doc.setFontSize(12).setFont('helvetica', 'bold')
      const wrapped = doc.splitTextToSize(trimmed.slice(4), largura)
      doc.text(wrapped, marginX, y)
      y += wrapped.length * 16 + 4

    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      doc.setFontSize(11).setFont('helvetica', 'normal')
      const texto = '•  ' + trimmed.slice(2)
      const wrapped = doc.splitTextToSize(texto, largura - 10)
      saltarLinha(0)
      doc.text(wrapped, marginX + 8, y)
      y += wrapped.length * 15 + 3

    } else if (/^\d+\.\s/.test(trimmed)) {
      doc.setFontSize(11).setFont('helvetica', 'normal')
      const wrapped = doc.splitTextToSize(trimmed, largura - 10)
      saltarLinha(0)
      doc.text(wrapped, marginX + 8, y)
      y += wrapped.length * 15 + 3

    } else if (trimmed === '' || trimmed === '---') {
      y += 10

    } else {
      // Parágrafo normal — processa **bold** inline
      doc.setFontSize(11)
      const partes = trimmed.split(/(\*\*[^*]+\*\*)/)
      let x = marginX
      const alturaLinha = 15

      // Pré-calcula o texto completo para wrap
      const textoPlano = trimmed.replace(/\*\*([^*]+)\*\*/g, '$1')
      const wrapped = doc.splitTextToSize(textoPlano, largura)
      saltarLinha(0)

      if (partes.length === 1) {
        // Sem bold — simples
        doc.setFont('helvetica', 'normal')
        doc.text(wrapped, marginX, y)
      } else {
        // Com bold — renderiza palavra por palavra na primeira linha
        // (bold inline em jsPDF exige controle manual de x)
        for (const parte of partes) {
          if (parte.startsWith('**') && parte.endsWith('**')) {
            doc.setFont('helvetica', 'bold')
            const t = parte.slice(2, -2)
            doc.text(t, x, y)
            x += doc.getTextWidth(t)
          } else {
            doc.setFont('helvetica', 'normal')
            doc.text(parte, x, y)
            x += doc.getTextWidth(parte)
          }
        }
      }
      y += wrapped.length * alturaLinha + 3
    }
  }

  const nomeArquivo = artifact.title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    + '.pdf'

  doc.save(nomeArquivo)
}

// ── Componente PainelArtifact ──────────────────────────────────────────────
function PainelArtifact({
  artifact, copiado, onCopiar, onBaixar, onFechar
}: {
  artifact: Artifact
  copiado: boolean
  onCopiar: () => void
  onBaixar: () => void
  onFechar: () => void
}) {
  const [aba, setAba] = useState<'preview' | 'codigo'>('preview')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const isDoc = artifact.type === 'document' || artifact.type === 'briefing'
  const isHtml = artifact.type === 'html'
  const isReact = artifact.type === 'react'
  const isCode = isHtml || isReact

  const typeLabel = artifact.type === 'briefing' ? 'Briefing' : isDoc ? 'Documento' : isHtml ? 'HTML' : isReact ? 'React' : artifact.type
  const typeColor = artifact.type === 'briefing' ? '#f0b429' : isDoc ? '#4f8ef7' : isHtml ? '#f97316' : isReact ? '#61dafb' : '#8892a4'

  // Monta o HTML que vai pro iframe
  const iframeContent = isHtml
    ? artifact.content
    : isReact
    ? `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f1117; color: #e2e8f0; font-family: system-ui, sans-serif; padding: 16px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script type="text/babel">
    const { useState, useEffect, useRef } = React;
    ${artifact.content}
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`
: ''

  const iframeCallback = useCallback((node: HTMLIFrameElement | null) => {
    if (node) iframeRef.current = node
  }, [])

  return (
    <div style={{
      width: 480, minWidth: 380, maxWidth: 560,
      borderLeft: `1px solid ${T.border}`,
      background: 'rgba(6,8,14,0.97)',
      display: 'flex', flexDirection: 'column',
      animation: 'slideInRight .2s ease-out'
    }}>

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {isDoc
          ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={typeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="1" width="10" height="14" rx="1.5"/><path d="M6 5h4M6 8h4M6 11h2"/></svg>
          : isHtml
          ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={typeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4l2 8 4-2 4 2 2-8"/></svg>
          : <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={typeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 2C4.5 2 2 5 2 8s2.5 6 6 6 6-3 6-6-2.5-6-6-6z"/></svg>
        }
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artifact.title}</div>
          <div style={{ fontSize: 10, color: typeColor, marginTop: 1 }}>{typeLabel}</div>
        </div>
        <button onClick={onFechar} style={{ width: 26, height: 26, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, transition: 'color .12s, background .12s', flexShrink: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(14,22,45,0.6)'; (e.currentTarget as HTMLElement).style.color = T.text }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = T.textMuted }}
        >✕</button>
      </div>

      {/* Abas Preview / Código — só para html e react */}
      {isCode && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {(['preview', 'codigo'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)} style={{
              flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 500, cursor: 'pointer',
              background: aba === a ? 'rgba(14,22,45,0.6)' : 'none', border: 'none',
              borderBottom: aba === a ? `2px solid ${typeColor}` : '2px solid transparent',
              color: aba === a ? T.text : T.textMuted, transition: 'all .15s'
            }}>
              {a === 'preview' ? '▶ Preview' : '{ } Código'}
            </button>
          ))}
        </div>
      )}

      {/* Conteúdo */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {isDoc ? (
          <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px', color: T.text, fontSize: 13.5, lineHeight: 1.8 }}>
            <ReactMarkdown components={{
              h1: ({ children }) => <h1 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: '0 0 12px 0', paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>{children}</h1>,
              h2: ({ children }) => <h2 style={{ fontSize: 15, fontWeight: 600, color: T.text, margin: '20px 0 8px 0' }}>{children}</h2>,
              h3: ({ children }) => <h3 style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', margin: '16px 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</h3>,
              p: ({ children }) => <p style={{ margin: '0 0 10px 0', color: T.textMuted }}>{children}</p>,
              strong: ({ children }) => <strong style={{ color: T.text, fontWeight: 600 }}>{children}</strong>,
              ul: ({ children }) => <ul style={{ margin: '4px 0 10px 0', paddingLeft: 18 }}>{children}</ul>,
              ol: ({ children }) => <ol style={{ margin: '4px 0 10px 0', paddingLeft: 18 }}>{children}</ol>,
              li: ({ children }) => <li style={{ marginBottom: 5, color: T.textMuted }}>{children}</li>,
              hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${T.border}`, margin: '16px 0' }} />,
              table: ({ children }) => <div style={{ overflowX: 'auto', margin: '10px 0' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>{children}</table></div>,
              thead: ({ children }) => <thead style={{ background: 'rgba(14,22,45,0.6)' }}>{children}</thead>,
              th: ({ children }) => <th style={{ padding: '6px 12px', textAlign: 'left', color: T.textMuted, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${T.border}` }}>{children}</th>,
              td: ({ children }) => <td style={{ padding: '6px 12px', color: T.textMuted, borderBottom: `0.5px solid ${T.border}` }}>{children}</td>,
              code: ({ children }: any) => <code style={{ fontFamily: 'monospace', background: T.bg, padding: '1px 5px', borderRadius: 3, fontSize: 12, color: '#a78bfa' }}>{children}</code>,
              blockquote: ({ children }) => <blockquote style={{ borderLeft: `3px solid ${T.accentBlue}`, margin: '10px 0', padding: '4px 14px', color: T.textMuted, fontStyle: 'italic' }}>{children}</blockquote>
            }}>{artifact.content}</ReactMarkdown>
          </div>
        ) : aba === 'preview' ? (
          <iframe
            ref={iframeCallback}
            sandbox="allow-scripts"
            srcDoc={iframeContent}
            style={{ width: '100%', height: '100%', border: 'none', background: '#0f1117' }}
            title={artifact.title}
          />
        ) : (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <SyntaxHighlighter
              style={vscDarkPlus}
              language={isHtml ? 'html' : 'jsx'}
              PreTag="div"
              customStyle={{ margin: 0, background: '#0a0c14', padding: '16px', fontSize: 12, height: '100%' }}
            >
              {artifact.content}
            </SyntaxHighlighter>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={onCopiar} style={{
          flex: 1, padding: '8px 0', borderRadius: 8,
          background: copiado ? `${T.accentGreen}22` : 'rgba(14,22,45,0.6)',
          border: `1px solid ${copiado ? T.accentGreen : T.border}`,
          color: copiado ? T.accentGreen : T.textMuted,
          fontSize: 12, fontWeight: 500, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s'
        }}
          onMouseEnter={e => { if (!copiado) { (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}55`; (e.currentTarget as HTMLElement).style.color = T.text } }}
          onMouseLeave={e => { if (!copiado) { (e.currentTarget as HTMLElement).style.borderColor = T.border; (e.currentTarget as HTMLElement).style.color = T.textMuted } }}
        >
          {copiado
            ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l3 3 7-7"/></svg> Copiado</>
            : <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="8" height="10" rx="1.5"/><path d="M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1"/></svg> Copiar código</>
          }
        </button>
        {isDoc && (
          <div style={{ flex: 1, display: 'flex', gap: 6 }}>
            <button onClick={onBaixar} style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              background: `${T.accentBlue}22`, border: `1px solid ${T.accentBlue}55`, color: T.accentBlue,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s'
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}33`; (e.currentTarget as HTMLElement).style.borderColor = T.accentBlue }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${T.accentBlue}22`; (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}55` }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v8M5 8l3 3 3-3"/><path d="M3 13h10"/>
              </svg>
              .docx
            </button>
            <button onClick={() => baixarPdf(artifact)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              background: `${T.accentRed}22`, border: `1px solid ${T.accentRed}55`, color: T.accentRed,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s'
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${T.accentRed}33`; (e.currentTarget as HTMLElement).style.borderColor = T.accentRed }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${T.accentRed}22`; (e.currentTarget as HTMLElement).style.borderColor = `${T.accentRed}55` }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v8M5 8l3 3 3-3"/><path d="M3 13h10"/>
              </svg>
              .pdf
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Componente ReasoningBlock ──────────────────────────────────────────────
function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming?: boolean }) {
  const [aberto, setAberto] = useState(true)

  useEffect(() => {
    if (!streaming) setAberto(false)
  }, [streaming])

  return (
    <div style={{ marginBottom: 10, border: `0.5px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setAberto(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', background: 'rgba(6,8,14,0.97)', border: 'none',
          cursor: 'pointer', textAlign: 'left', transition: 'background .12s'
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(14,22,45,0.6)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(6,8,14,0.97)'}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/>
        </svg>
        <span style={{ fontSize: 11, color: T.textMuted, flex: 1 }}>
          {streaming ? 'Raciocinando...' : 'Ver raciocínio'}
        </span>
        {streaming && (
          <span style={{ display: 'flex', gap: 2 }}>
            {[0,1,2].map(k => (
              <span key={k} style={{ width: 3, height: 3, borderRadius: '50%', background: T.textMuted, display: 'inline-block', animation: `fadedot 1.2s ease-in-out infinite ${k * 0.2}s` }} />
            ))}
          </span>
        )}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round"
          style={{ transform: aberto ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s', flexShrink: 0 }}
        >
          <path d="M2 3l3 3 3-3"/>
        </svg>
      </button>
      {aberto && (
        <div style={{ padding: '8px 12px', background: T.bg, borderTop: `0.5px solid ${T.border}` }}>
          <p style={{ fontSize: 12, color: `${T.textMuted}55`, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
            {reasoning}
            {streaming && <span style={{ display: 'inline-block', width: 2, height: 12, background: T.textMuted, marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s infinite' }} />}
          </p>
        </div>
      )}
    </div>
  )
}