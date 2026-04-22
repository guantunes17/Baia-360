import { useState, useEffect, useCallback } from 'react'
import { API } from '@/config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Evento {
  evento_id:    string
  titulo:       string
  inicio:       string
  fim:          string
  local:        string
  organizador:  string
  dia_inteiro:  boolean
  resumo:       string
  link_web:     string
  link_reuniao: string
}

interface EventoLocal {
  date:  string  // YYYY-MM-DD
  time:  string  // HH:MM
  title: string
  loc:   string
  color: 'blue' | 'green' | 'purple'
  hasLink: boolean
  raw:   Evento
}

interface NovoEvento {
  titulo:      string
  data:        string
  hora_inicio: string
  hora_fim:    string
  local:       string
  descricao:   string
}

interface EditarEvento {
  titulo:      string
  data:        string
  hora_inicio: string
  hora_fim:    string
  local:       string
  descricao:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const DIAS_SEMANA = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB']

function pad(n: number) { return String(n).padStart(2, '0') }

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
}

function formatarHoraBRT(isoStr: string): string {
  if (!isoStr) return ''
  try {
    // Com o header Prefer do Graph, o datetime vem sem 'Z' (já em BRT)
    // Truncamos para 19 chars para remover microsegundos
    const limpo = isoStr.substring(0, 19)
    const d = new Date(limpo)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function formatarDataHora(isoStr: string): string {
  if (!isoStr) return ''
  try {
    const limpo = isoStr.substring(0, 19)
    const d = new Date(limpo)
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) +
           ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch { return isoStr }
}

function corEvento(idx: number): 'blue' | 'green' | 'purple' {
  return (['blue', 'green', 'purple'] as const)[idx % 3]
}

// Extrai data YYYY-MM-DD de string ISO sem 'Z' (já em BRT)
function extrairData(isoStr: string): string {
  if (!isoStr) return ''
  return isoStr.substring(0, 10)
}

// Extrai HH:MM de string ISO sem 'Z'
function extrairHora(isoStr: string): string {
  if (!isoStr) return ''
  return isoStr.substring(11, 16)
}

// ── Estilos compartilhados ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#8892a4', display: 'block',
  marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase'
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0f1117', border: '0.5px solid #2d3148',
  borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 13,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box'
}
const btnCancelStyle: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid #2d3148', borderRadius: 8,
  color: '#8892a4', padding: '7px 16px', fontSize: 13, cursor: 'pointer'
}
const btnSaveStyle: React.CSSProperties = {
  background: '#4f8ef7', border: 'none', borderRadius: 8,
  color: 'white', padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500
}
const btnDangerStyle: React.CSSProperties = {
  background: '#ef444415', border: '0.5px solid #ef444433', borderRadius: 8,
  color: '#ef4444', padding: '7px 16px', fontSize: 13, cursor: 'pointer'
}

// ── Modal: Novo Evento ────────────────────────────────────────────────────────

function ModalNovoEvento({
  dataInicial, onSalvar, onFechar, salvando
}: {
  dataInicial: string
  onSalvar: (ev: NovoEvento) => void
  onFechar: () => void
  salvando: boolean
}) {
  const [form, setForm] = useState<NovoEvento>({
    titulo: '', data: dataInicial, hora_inicio: '09:00', hora_fim: '10:00', local: '', descricao: ''
  })
  const [erroForm, setErroForm] = useState('')

  const campo = (key: keyof NovoEvento) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }))

  const handleSalvar = () => {
    if (!form.titulo.trim()) { setErroForm('Informe o título do evento.'); return }
    if (!form.data)           { setErroForm('Informe a data.'); return }
    if (form.hora_inicio >= form.hora_fim) { setErroForm('O horário de início deve ser anterior ao fim.'); return }
    setErroForm('')
    onSalvar(form)
  }

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 12, padding: 24, width: 360, maxWidth: '90vw' }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: '#e2e8f0', marginBottom: 18 }}>Novo evento</div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Título</label>
          <input value={form.titulo} onChange={campo('titulo')} placeholder="Ex: Reunião com GSK" style={inputStyle} autoFocus />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Data</label>
          <input type="date" value={form.data} onChange={campo('data')} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Início</label>
            <input type="time" value={form.hora_inicio} onChange={campo('hora_inicio')} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Fim</label>
            <input type="time" value={form.hora_fim} onChange={campo('hora_fim')} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Local (opcional)</label>
          <input value={form.local} onChange={campo('local')} placeholder="Sala A / Teams / Endereço" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Descrição (opcional)</label>
          <textarea value={form.descricao} onChange={campo('descricao')} placeholder="Pauta, link de acesso..." style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} />
        </div>

        {erroForm && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{erroForm}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onFechar} style={btnCancelStyle}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando} style={btnSaveStyle}>
            {salvando ? 'Salvando...' : 'Salvar no Outlook'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Detalhe do Evento ──────────────────────────────────────────────────

function ModalDetalheEvento({
  ev, onFechar, onDeletar, onEditar, deletando
}: {
  ev: Evento
  onFechar: () => void
  onDeletar: () => void
  onEditar: () => void
  deletando: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const temLinkReuniao = !!ev.link_reuniao
  const temLinkWeb     = !!ev.link_web

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 12, padding: 24, width: 400, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3 }}>{ev.titulo}</div>
            {ev.organizador && (
              <div style={{ fontSize: 12, color: '#8892a4', marginTop: 4 }}>Organizado por {ev.organizador}</div>
            )}
          </div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', color: '#8892a4', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2, flexShrink: 0 }}>✕</button>
        </div>

        {/* Linha divisória */}
        <div style={{ height: '0.5px', background: '#2d3148', marginBottom: 16 }} />

        {/* Horário */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 15, marginTop: 1 }}>🕐</span>
          <div>
            {ev.dia_inteiro ? (
              <div style={{ fontSize: 13, color: '#e2e8f0' }}>Dia inteiro — {extrairData(ev.inicio)}</div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: '#e2e8f0' }}>{formatarDataHora(ev.inicio)}</div>
                <div style={{ fontSize: 12, color: '#8892a4', marginTop: 2 }}>até {formatarHoraBRT(ev.fim)}</div>
              </>
            )}
          </div>
        </div>

        {/* Local */}
        {ev.local && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 15, marginTop: 1 }}>📍</span>
            <div style={{ fontSize: 13, color: '#e2e8f0' }}>{ev.local}</div>
          </div>
        )}

        {/* Link de reunião online */}
        {temLinkReuniao && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 15 }}>🎥</span>
            <a
              href={ev.link_reuniao}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: '#4f8ef7', textDecoration: 'none', fontWeight: 500 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.textDecoration = 'underline'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.textDecoration = 'none'}
            >
              Entrar na reunião Teams
            </a>
          </div>
        )}

        {/* Link web do evento no Outlook */}
        {temLinkWeb && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 15 }}>🔗</span>
            <a
              href={ev.link_web}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: '#8892a4', textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#e2e8f0'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#8892a4'}
            >
              Abrir no Outlook Web
            </a>
          </div>
        )}

        {/* Descrição / corpo */}
        {ev.resumo && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#8892a4', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Descrição</div>
            <div style={{ fontSize: 13, color: '#8892a4', background: '#0f1117', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6, maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {ev.resumo}
            </div>
          </div>
        )}

        {/* Ações */}
        {!confirmDelete ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setConfirmDelete(true)} style={btnDangerStyle}>Deletar</button>
            <button onClick={onEditar} style={btnCancelStyle}>Editar</button>
          </div>
        ) : (
          <div style={{ background: '#ef444411', border: '0.5px solid #ef444433', borderRadius: 8, padding: '12px 14px', marginTop: 8 }}>
            <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 10 }}>Tem certeza? Este evento será removido do Outlook.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(false)} style={btnCancelStyle}>Cancelar</button>
              <button onClick={onDeletar} disabled={deletando} style={{ ...btnDangerStyle, background: '#ef4444', color: '#fff', border: 'none' }}>
                {deletando ? 'Deletando...' : 'Confirmar deleção'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Modal: Editar Evento ──────────────────────────────────────────────────────

function ModalEditarEvento({
  ev, onSalvar, onFechar, salvando
}: {
  ev: Evento
  onSalvar: (dados: EditarEvento) => void
  onFechar: () => void
  salvando: boolean
}) {
  const [form, setForm] = useState<EditarEvento>({
    titulo:      ev.titulo,
    data:        extrairData(ev.inicio),
    hora_inicio: extrairHora(ev.inicio),
    hora_fim:    extrairHora(ev.fim),
    local:       ev.local || '',
    descricao:   ev.resumo || ''
  })
  const [erroForm, setErroForm] = useState('')

  const campo = (key: keyof EditarEvento) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }))

  const handleSalvar = () => {
    if (!form.titulo.trim()) { setErroForm('Informe o título.'); return }
    if (form.hora_inicio >= form.hora_fim) { setErroForm('Início deve ser anterior ao fim.'); return }
    setErroForm('')
    onSalvar(form)
  }

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 12, padding: 24, width: 360, maxWidth: '90vw' }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: '#e2e8f0', marginBottom: 18 }}>Editar evento</div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Título</label>
          <input value={form.titulo} onChange={campo('titulo')} style={inputStyle} autoFocus />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Data</label>
          <input type="date" value={form.data} onChange={campo('data')} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Início</label>
            <input type="time" value={form.hora_inicio} onChange={campo('hora_inicio')} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Fim</label>
            <input type="time" value={form.hora_fim} onChange={campo('hora_fim')} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Local (opcional)</label>
          <input value={form.local} onChange={campo('local')} placeholder="Sala A / Teams / Endereço" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Descrição (opcional)</label>
          <textarea value={form.descricao} onChange={campo('descricao')} style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} />
        </div>

        {erroForm && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{erroForm}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onFechar} style={btnCancelStyle}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando} style={btnSaveStyle}>
            {salvando ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente Principal ───────────────────────────────────────────────────────

export function Agenda() {
  const hoje = new Date()
  const [mesCurrent, setMesCurrent]     = useState(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const [diaSelecionado, setDiaSelecionado] = useState(toDateStr(hoje))
  const [eventos, setEventos]           = useState<EventoLocal[]>([])
  const [conectado, setConectado]       = useState<boolean | null>(null)
  const [carregando, setCarregando]     = useState(false)
  const [modalNovo, setModalNovo]       = useState(false)
  const [salvandoEvento, setSalvandoEvento] = useState(false)
  const [toastMsg, setToastMsg]         = useState<string | null>(null)
  const [erroMsg, setErroMsg]           = useState<string | null>(null)
  const [eventoDetalhe, setEventoDetalhe] = useState<Evento | null>(null)
  const [eventoEditar, setEventoEditar] = useState<Evento | null>(null)
  const [deletando, setDeletando]       = useState(false)
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)

  const toast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 4000) }

  // Verifica conexão Outlook
  useEffect(() => {
    fetch(`${API}/api/oauth/outlook/status`, { headers: headers() })
      .then(r => r.json())
      .then(d => setConectado(d.conectado))
      .catch(() => setConectado(false))
  }, [])

  // Carrega eventos do mês
  const carregarEventos = useCallback(async () => {
    if (!conectado) return
    setCarregando(true)
    setErroMsg(null)
    try {
      const ano    = mesCurrent.getFullYear()
      const mes    = mesCurrent.getMonth()
      const inicio = `${ano}-${pad(mes+1)}-01`
      const fim    = toDateStr(new Date(ano, mes+1, 0))

      const res  = await fetch(`${API}/api/outlook/agenda?data_inicio=${inicio}&data_fim=${fim}`, { headers: headers() })
      const data = await res.json()

      if (!res.ok) { setErroMsg(data.erro || 'Erro ao carregar agenda.'); return }

      const evsMapeados: EventoLocal[] = (data.eventos || []).map((ev: Evento, i: number) => {
        const dateKey = ev.dia_inteiro
          ? ev.inicio.slice(0, 10)
          : extrairData(ev.inicio)
        return {
          date:    dateKey,
          time:    ev.dia_inteiro ? '' : formatarHoraBRT(ev.inicio),
          title:   ev.titulo,
          loc:     ev.local,
          color:   corEvento(i),
          hasLink: !!ev.link_reuniao,
          raw:     ev
        }
      })
      setEventos(evsMapeados)
    } catch {
      setErroMsg('Não foi possível carregar os eventos.')
    } finally {
      setCarregando(false)
    }
  }, [conectado, mesCurrent])

  useEffect(() => { carregarEventos() }, [carregarEventos])

  // Criar evento
  const salvarEvento = async (ev: NovoEvento) => {
    setSalvandoEvento(true)
    try {
      const res  = await fetch(`${API}/api/outlook/evento`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(ev)
      })
      const data = await res.json()
      if (!res.ok) { setErroMsg(data.erro || 'Erro ao criar evento.'); return }
      setModalNovo(false)
      toast(`Evento "${ev.titulo}" criado no Outlook!`)
      carregarEventos()
    } catch {
      setErroMsg('Não foi possível criar o evento.')
    } finally {
      setSalvandoEvento(false)
    }
  }

  // Deletar evento
  const deletarEvento = async () => {
    if (!eventoDetalhe) return
    setDeletando(true)
    try {
      const res = await fetch(`${API}/api/outlook/evento/${encodeURIComponent(eventoDetalhe.evento_id)}`, {
        method: 'DELETE',
        headers: headers()
      })
      if (!res.ok) {
        const data = await res.json()
        setErroMsg(data.erro || 'Erro ao deletar evento.')
        return
      }
      setEventoDetalhe(null)
      toast(`Evento "${eventoDetalhe.titulo}" removido do Outlook.`)
      carregarEventos()
    } catch {
      setErroMsg('Não foi possível deletar o evento.')
    } finally {
      setDeletando(false)
    }
  }

  // Editar evento
  const salvarEdicao = async (dados: EditarEvento) => {
    if (!eventoEditar) return
    setSalvandoEdicao(true)
    try {
      const res = await fetch(`${API}/api/outlook/evento/${encodeURIComponent(eventoEditar.evento_id)}`, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      })
      const data = await res.json()
      if (!res.ok) { setErroMsg(data.erro || 'Erro ao editar evento.'); return }
      setEventoEditar(null)
      setEventoDetalhe(null)
      toast(`Evento "${dados.titulo}" atualizado no Outlook!`)
      carregarEventos()
    } catch {
      setErroMsg('Não foi possível editar o evento.')
    } finally {
      setSalvandoEdicao(false)
    }
  }

  // ── Render do grid ────────────────────────────────────────────────────────────

  const renderGrid = () => {
    const ano       = mesCurrent.getFullYear()
    const mes       = mesCurrent.getMonth()
    const first     = new Date(ano, mes, 1).getDay()
    const total     = new Date(ano, mes+1, 0).getDate()
    const prevTotal = new Date(ano, mes, 0).getDate()
    const todayStr  = toDateStr(hoje)
    const cells: React.ReactNode[] = []

    for (let i = 0; i < first; i++) {
      const d  = prevTotal - first + 1 + i
      const ds = `${ano}-${pad(mes)}-${pad(d)}`
      cells.push(<DiaCell key={`prev-${i}`} num={d} dateStr={ds} outro carregando={carregando}
        eventos={[]} selecionado={false} hoje={false} onClick={() => {}} />)
    }

    for (let d = 1; d <= total; d++) {
      const ds  = `${ano}-${pad(mes+1)}-${pad(d)}`
      const evs = eventos.filter(e => e.date === ds)
      cells.push(<DiaCell key={ds} num={d} dateStr={ds} outro={false} carregando={carregando}
        eventos={evs} selecionado={ds === diaSelecionado} hoje={ds === todayStr}
        onClick={() => setDiaSelecionado(ds)} />)
    }

    const restante = 42 - first - total
    for (let d = 1; d <= restante; d++) {
      const ds = `${ano}-${pad(mes+2)}-${pad(d)}`
      cells.push(<DiaCell key={`next-${d}`} num={d} dateStr={ds} outro carregando={carregando}
        eventos={[]} selecionado={false} hoje={false} onClick={() => {}} />)
    }
    return cells
  }

  const eventosDia = eventos.filter(e => e.date === diaSelecionado)
  const [sdAno, sdMes, sdDia] = diaSelecionado.split('-')

  return (
    <div style={{ padding: '24px 32px', background: '#0f1117', minHeight: '100%', color: '#e2e8f0', fontFamily: 'inherit' }}>

      {/* Toast */}
      {toastMsg && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1a1d27', border: '0.5px solid #10b98166', borderLeft: '3px solid #10b981', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#e2e8f0', zIndex: 200, minWidth: 280 }}>
          {toastMsg}
        </div>
      )}

      {/* Modais */}
      {modalNovo && (
        <ModalNovoEvento
          dataInicial={diaSelecionado}
          onSalvar={salvarEvento}
          onFechar={() => setModalNovo(false)}
          salvando={salvandoEvento}
        />
      )}

      {eventoDetalhe && !eventoEditar && (
        <ModalDetalheEvento
          ev={eventoDetalhe}
          onFechar={() => setEventoDetalhe(null)}
          onDeletar={deletarEvento}
          onEditar={() => setEventoEditar(eventoDetalhe)}
          deletando={deletando}
        />
      )}

      {eventoEditar && (
        <ModalEditarEvento
          ev={eventoEditar}
          onSalvar={salvarEdicao}
          onFechar={() => setEventoEditar(null)}
          salvando={salvandoEdicao}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0' }}>
            {MESES[mesCurrent.getMonth()]} {mesCurrent.getFullYear()}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setMesCurrent(new Date(mesCurrent.getFullYear(), mesCurrent.getMonth()-1, 1))} style={navBtnStyle}>&#8249;</button>
            <button onClick={() => setMesCurrent(new Date(hoje.getFullYear(), hoje.getMonth(), 1))} style={{ ...navBtnStyle, padding: '0 12px', fontSize: 11 }}>Hoje</button>
            <button onClick={() => setMesCurrent(new Date(mesCurrent.getFullYear(), mesCurrent.getMonth()+1, 1))} style={navBtnStyle}>&#8250;</button>
          </div>
          {carregando && <span style={{ fontSize: 11, color: '#8892a4' }}>Atualizando...</span>}
        </div>
        <button onClick={() => setModalNovo(true)} style={{ background: '#4f8ef7', border: 'none', borderRadius: 8, color: 'white', padding: '0 16px', height: 32, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Novo evento
        </button>
      </div>

      {/* Status Outlook */}
      {conectado === false && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f0b429', flexShrink: 0 }} />
          <span style={{ color: '#8892a4' }}>Outlook não conectado — eventos do calendário não serão exibidos.</span>
          <span style={{ color: '#4f8ef7', marginLeft: 'auto', cursor: 'pointer' }}>Como conectar?</span>
        </div>
      )}

      {erroMsg && (
        <div style={{ padding: '8px 14px', background: '#ef444411', border: '0.5px solid #ef444433', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#ef4444' }}>
          {erroMsg}
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 1 }}>
        {DIAS_SEMANA.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#8892a4', padding: '6px 0', fontWeight: 500, letterSpacing: '0.04em' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#2d3148', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        {renderGrid()}
      </div>

      {/* Painel do dia selecionado */}
      <div style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>
            Eventos — {sdDia}/{sdMes}/{sdAno}
          </span>
          <button onClick={() => setModalNovo(true)} style={{ fontSize: 11, color: '#4f8ef7', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            + Adicionar evento
          </button>
        </div>

        {eventosDia.length === 0 ? (
          <div style={{ fontSize: 13, color: '#8892a4', padding: '4px 0' }}>
            {conectado ? 'Nenhum evento neste dia.' : 'Conecte o Outlook para ver seus eventos.'}
          </div>
        ) : (
          eventosDia.map((ev, i) => {
            const COR_MAP: Record<string, string> = { blue: '#4f8ef7', green: '#10b981', purple: '#a78bfa' }
            const cor = COR_MAP[ev.color]
            return (
              <div
                key={i}
                onClick={() => setEventoDetalhe(ev.raw)}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 8px', borderBottom: i < eventosDia.length-1 ? '0.5px solid #2d3148' : 'none', cursor: 'pointer', borderRadius: 6, transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#0f1117'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: cor, marginTop: 5, flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: '#8892a4', minWidth: 44, marginTop: 1 }}>{ev.time || 'Dia todo'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#e2e8f0' }}>{ev.title}</div>
                  {ev.loc && <div style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{ev.loc}</div>}
                </div>
                {/* Indicador de reunião online */}
                {ev.hasLink && (
                  <div style={{ fontSize: 10, color: '#4f8ef7', background: '#4f8ef715', border: '0.5px solid #4f8ef733', borderRadius: 4, padding: '2px 6px', flexShrink: 0, alignSelf: 'center' }}>
                    Teams
                  </div>
                )}
                {/* Seta indicando que é clicável */}
                <div style={{ color: '#2d3148', fontSize: 12, alignSelf: 'center', flexShrink: 0 }}>›</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Sub-componente de célula do dia ───────────────────────────────────────────

function DiaCell({ num, dateStr, outro, eventos, selecionado, hoje, onClick, carregando }: {
  num: number
  dateStr: string
  outro: boolean
  eventos: EventoLocal[]
  selecionado: boolean
  hoje: boolean
  onClick: () => void
  carregando: boolean
}) {
  const COR: Record<string, string> = { blue: '#4f8ef7', green: '#10b981', purple: '#a78bfa' }
  const BG:  Record<string, string> = { blue: '#4f8ef722', green: '#10b98122', purple: '#7c3aed22' }

  return (
    <div
      onClick={onClick}
      style={{
        background:  selecionado ? '#4f8ef711' : hoje ? '#1a1d27' : outro ? '#0c0e15' : '#13161f',
        minHeight:   90,
        padding:     8,
        cursor:      outro ? 'default' : 'pointer',
        opacity:     outro ? 0.4 : 1,
        outline:     selecionado ? '1px solid #4f8ef744' : 'none',
        transition:  'background 0.1s',
        position:    'relative'
      }}
      onMouseEnter={e => { if (!outro) (e.currentTarget as HTMLElement).style.background = selecionado ? '#4f8ef718' : '#1a1d27' }}
      onMouseLeave={e => { if (!outro) (e.currentTarget as HTMLElement).style.background = selecionado ? '#4f8ef711' : hoje ? '#1a1d27' : '#13161f' }}
    >
      <div style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, marginBottom: 4, borderRadius: '50%',
        background: hoje ? '#4f8ef7' : 'transparent',
        color:      hoje ? 'white' : '#8892a4',
        fontWeight: hoje ? 500 : 400
      }}>
        {num}
      </div>

      {!carregando && eventos.slice(0, 2).map((ev, i) => (
        <div key={i} style={{
          fontSize: 10, padding: '2px 5px', borderRadius: 4, marginBottom: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          background: BG[ev.color], color: COR[ev.color],
          borderLeft: `2px solid ${COR[ev.color]}`
        }}>
          {ev.time ? `${ev.time} ${ev.title}` : ev.title}
        </div>
      ))}
      {!carregando && eventos.length > 2 && (
        <div style={{ fontSize: 10, color: '#8892a4', padding: '1px 5px' }}>+{eventos.length-2} mais</div>
      )}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 8,
  color: '#8892a4', width: 28, height: 28, display: 'flex', alignItems: 'center',
  justifyContent: 'center', cursor: 'pointer', fontSize: 16
}