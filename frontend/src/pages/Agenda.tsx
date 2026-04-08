import { useState, useEffect, useCallback } from 'react'
import { API } from '@/config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Evento {
  titulo:      string
  inicio:      string
  fim:         string
  local:       string
  organizador: string
  dia_inteiro: boolean
  resumo:      string
}

interface EventoLocal {
  date:  string  // YYYY-MM-DD
  time:  string  // HH:MM
  title: string
  loc:   string
  color: 'blue' | 'green' | 'purple'
  raw?:  Evento
}

interface NovoEvento {
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
  try {
    return new Date(isoStr).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
    })
  } catch { return '' }
}

function eventosDoMes(eventos: EventoLocal[], ano: number, mes: number): EventoLocal[] {
  const prefix = `${ano}-${pad(mes+1)}`
  return eventos.filter(e => e.date.startsWith(prefix))
}

function corEvento(idx: number): 'blue' | 'green' | 'purple' {
  return (['blue', 'green', 'purple'] as const)[idx % 3]
}

// ── Componente Modal de Novo Evento ───────────────────────────────────────────

function ModalNovoEvento({
  dataInicial,
  onSalvar,
  onFechar,
  salvando
}: {
  dataInicial: string
  onSalvar: (ev: NovoEvento) => void
  onFechar: () => void
  salvando: boolean
}) {
  const [form, setForm] = useState<NovoEvento>({
    titulo:      '',
    data:        dataInicial,
    hora_inicio: '09:00',
    hora_fim:    '10:00',
    local:       '',
    descricao:   ''
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
    <div
      onClick={onFechar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 12, padding: 24, width: 340, maxWidth: '90vw' }}
      >
        <div style={{ fontSize: 15, fontWeight: 500, color: '#e2e8f0', marginBottom: 18 }}>Novo evento</div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Título</label>
          <input value={form.titulo} onChange={campo('titulo')} placeholder="Ex: Reunião com GSK"
            style={inputStyle} autoFocus />
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
          <textarea value={form.descricao} onChange={campo('descricao')} placeholder="Pauta, link de acesso..."
            style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} />
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

// ── Estilos compartilhados ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#8892a4', display: 'block',
  marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase'
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0f1117', border: '0.5px solid #2d3148',
  borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 13,
  outline: 'none', fontFamily: 'inherit'
}
const btnCancelStyle: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid #2d3148', borderRadius: 8,
  color: '#8892a4', padding: '7px 16px', fontSize: 13, cursor: 'pointer'
}
const btnSaveStyle: React.CSSProperties = {
  background: '#4f8ef7', border: 'none', borderRadius: 8,
  color: 'white', padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500
}

// ── Componente Principal ───────────────────────────────────────────────────────

export function Agenda() {
  const hoje      = new Date()
  const [mesCurrent, setMesCurrent]   = useState(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const [diaSelecionado, setDiaSelecionado] = useState(toDateStr(hoje))
  const [eventos, setEventos]         = useState<EventoLocal[]>([])
  const [conectado, setConectado]     = useState<boolean | null>(null)
  const [carregando, setCarregando]   = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [salvandoEvento, setSalvandoEvento] = useState(false)
  const [toastMsg, setToastMsg]       = useState<string | null>(null)
  const [erroMsg, setErroMsg]         = useState<string | null>(null)

  // Verifica se Outlook está conectado
  useEffect(() => {
    fetch(`${API}/api/oauth/outlook/status`, { headers: headers() })
      .then(r => r.json())
      .then(d => setConectado(d.conectado))
      .catch(() => setConectado(false))
  }, [])

  // Carrega eventos do mês atual quando conectado
  const carregarEventos = useCallback(async () => {
    if (!conectado) return
    setCarregando(true)
    setErroMsg(null)
    try {
      const ano = mesCurrent.getFullYear()
      const mes = mesCurrent.getMonth()
      const inicio = `${ano}-${pad(mes+1)}-01`
      const ultimo = new Date(ano, mes+1, 0)
      const fim    = toDateStr(ultimo)

      const res  = await fetch(`${API}/api/outlook/agenda?data_inicio=${inicio}&data_fim=${fim}`, { headers: headers() })
      const data = await res.json()

      if (!res.ok) { setErroMsg(data.erro || 'Erro ao carregar agenda.'); return }

      const evsMapeados: EventoLocal[] = (data.eventos || []).map((ev: Evento, i: number) => {
        const dateKey = ev.dia_inteiro
          ? ev.inicio.slice(0, 10)
          : new Date(ev.inicio).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
        return {
          date:  dateKey,
          time:  ev.dia_inteiro ? '' : formatarHoraBRT(ev.inicio),
          title: ev.titulo,
          loc:   ev.local,
          color: corEvento(i),
          raw:   ev
        }
      })
      setEventos(evsMapeados)
    } catch (e) {
      setErroMsg('Não foi possível carregar os eventos.')
    } finally {
      setCarregando(false)
    }
  }, [conectado, mesCurrent])

  useEffect(() => { carregarEventos() }, [carregarEventos])

  // Salva novo evento no Outlook
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

      setModalAberto(false)
      setToastMsg(`Evento "${ev.titulo}" criado no Outlook!`)
      setTimeout(() => setToastMsg(null), 4000)
      carregarEventos() // Recarrega para mostrar o novo evento
    } catch {
      setErroMsg('Não foi possível criar o evento.')
    } finally {
      setSalvandoEvento(false)
    }
  }

  // ── Render do grid do calendário ─────────────────────────────────────────────

  const renderGrid = () => {
    const ano    = mesCurrent.getFullYear()
    const mes    = mesCurrent.getMonth()
    const first  = new Date(ano, mes, 1).getDay()
    const total  = new Date(ano, mes+1, 0).getDate()
    const prevTotal = new Date(ano, mes, 0).getDate()
    const todayStr  = toDateStr(hoje)
    const cells: React.ReactNode[] = []

    // Dias do mês anterior
    for (let i = 0; i < first; i++) {
      const d  = prevTotal - first + 1 + i
      const ds = `${ano}-${pad(mes)}-${pad(d)}`
      cells.push(<DiaCell key={`prev-${i}`} num={d} dateStr={ds} outro carregando={carregando}
        eventos={[]} selecionado={false} hoje={false} onClick={() => {}} />)
    }

    // Dias do mês atual
    for (let d = 1; d <= total; d++) {
      const ds  = `${ano}-${pad(mes+1)}-${pad(d)}`
      const evs = eventos.filter(e => e.date === ds)
      cells.push(<DiaCell key={ds} num={d} dateStr={ds} outro={false} carregando={carregando}
        eventos={evs} selecionado={ds === diaSelecionado} hoje={ds === todayStr}
        onClick={() => setDiaSelecionado(ds)} />)
    }

    // Dias do próximo mês
    const restante = 42 - first - total
    for (let d = 1; d <= restante; d++) {
      const ds = `${ano}-${pad(mes+2)}-${pad(d)}`
      cells.push(<DiaCell key={`next-${d}`} num={d} dateStr={ds} outro carregando={carregando}
        eventos={[]} selecionado={false} hoje={false} onClick={() => {}} />)
    }
    return cells
  }

  // Eventos do dia selecionado
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

      {/* Modal */}
      {modalAberto && (
        <ModalNovoEvento
          dataInicial={diaSelecionado}
          onSalvar={salvarEvento}
          onFechar={() => setModalAberto(false)}
          salvando={salvandoEvento}
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
        <button onClick={() => setModalAberto(true)} style={{ background: '#4f8ef7', border: 'none', borderRadius: 8, color: 'white', padding: '0 16px', height: 32, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Novo evento
        </button>
      </div>

      {/* Barra de status Outlook */}
      {conectado === false && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#1a1d27', border: '0.5px solid #2d3148', borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f0b429', flexShrink: 0 }} />
          <span style={{ color: '#8892a4' }}>Outlook não conectado — eventos do calendário não serão exibidos.</span>
          <span style={{ color: '#4f8ef7', marginLeft: 'auto', cursor: 'pointer' }}
            onClick={() => (window as any)._toast?.('aviso', 'Conecte o Outlook em Perfil → Integrações.')}>
            Como conectar?
          </span>
        </div>
      )}

      {erroMsg && (
        <div style={{ padding: '8px 14px', background: '#ef444411', border: '0.5px solid #ef444433', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#ef4444' }}>
          {erroMsg}
        </div>
      )}

      {/* Grid semanal */}
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
          <button onClick={() => setModalAberto(true)} style={{ fontSize: 11, color: '#4f8ef7', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            + Adicionar evento
          </button>
        </div>

        {eventosDia.length === 0 ? (
          <div style={{ fontSize: 13, color: '#8892a4', padding: '4px 0' }}>
            {conectado ? 'Nenhum evento neste dia.' : 'Conecte o Outlook para ver seus eventos.'}
          </div>
        ) : (
          eventosDia.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: i < eventosDia.length-1 ? '0.5px solid #2d3148' : 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: ev.color === 'blue' ? '#4f8ef7' : ev.color === 'green' ? '#10b981' : '#a78bfa', marginTop: 4, flexShrink: 0 }} />
              <div style={{ fontSize: 11, color: '#8892a4', minWidth: 44, marginTop: 1 }}>{ev.time || 'Dia todo'}</div>
              <div>
                <div style={{ fontSize: 13, color: '#e2e8f0' }}>{ev.title}</div>
                {ev.loc && <div style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{ev.loc}</div>}
              </div>
            </div>
          ))
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
      {/* Número do dia */}
      <div style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, marginBottom: 4, borderRadius: '50%',
        background: hoje ? '#4f8ef7' : 'transparent',
        color:      hoje ? 'white' : '#8892a4',
        fontWeight: hoje ? 500 : 400
      }}>
        {num}
      </div>

      {/* Pílulas de evento */}
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