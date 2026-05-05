import { useState, useEffect } from 'react'
import axios from 'axios'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

const CORES_MODULO: Record<string, string> = {
  'Fretes':            '#7c3aed',
  'Armazenagem':       '#10b981',
  'Pedidos':           '#4f8ef7',
  'Recebimentos':      '#0891b2',
  'Cap. Operacional':  '#e11d48',
  'Estoque':           '#f59e0b',
  'Fat. Distribuição': '#ea580c',
  'Fat. Armazenagem':  '#7c3aed',
}

const KPI_LABELS: Record<string, Record<string, string>> = {
  'Pedidos':           { total_ordens: 'Total Ordens', sla_pct: 'SLA %', excedidas: 'Excedidas' },
  'Fretes':            { total_frete: 'Custo Total (R$)', remetentes: 'Remetentes' },
  'Armazenagem':       { total_armazenagem: 'Faturamento (R$)', clientes: 'Clientes' },
  'Estoque':           { clientes: 'Clientes', maior_pico_m3: 'Maior Pico m³', maior_pico_cliente: 'Top Cliente' },
  'Recebimentos':      { total_recebimentos: 'Total Recebimentos', valor_total: 'Valor Total (R$)', depositantes: 'Depositantes' },
  'Fat. Distribuição': { total_frete: 'Total Fretes (R$)', clientes: 'Clientes' },
  'Fat. Armazenagem':  { total_faturamento: 'Faturamento (R$)', clientes: 'Clientes' },
  'Cap. Operacional':  { total_os: 'Total OS', depositantes: 'Depositantes' },
}

function formatarValor(chave: string, valor: any): string {
  if (valor === undefined || valor === null) return '—'
  if (chave.includes('frete') || chave.includes('armazenagem') || chave.includes('faturamento') || chave.includes('valor'))
    return `R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  if (chave === 'sla_pct') return `${Number(valor).toFixed(1)}%`
  if (chave.includes('m3')) return `${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m³`
  return String(valor)
}

function formatarMes(mes: string): string {
  if (!mes) return '—'
  if (mes.match(/^\d{4}-\d{2}$/)) {
    const [ano, m] = mes.split('-')
    return `${m}/${ano}`
  }
  if (mes.match(/^\d{2}-\d{4}$/)) {
    const [m, ano] = mes.split('-')
    return `${m}/${ano}`
  }
  return mes
}

function calcularDelta(valA: any, valB: any): { pct: number; label: string } | null {
  const a = Number(valA)
  const b = Number(valB)
  if (isNaN(a) || isNaN(b) || b === 0) return null
  const pct = ((a - b) / Math.abs(b)) * 100
  return { pct, label: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` }
}

interface ModuloKPI {
  modulo:    string
  mes_ref:   string
  gerado_em: string
  kpis:      Record<string, any>
}

function CardModulo({ dados, comparar }: { dados: ModuloKPI; comparar?: ModuloKPI }) {
  const cor    = CORES_MODULO[dados.modulo] || T.accentBlue
  const labels = KPI_LABELS[dados.modulo] || {}

  return (
    <div style={{
      ...glass(0.35, 20),
      boxShadow: neoShadow,
      borderRadius: 10,
      borderColor: `${cor}44`,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: cor }}>{dados.modulo}</span>
        {comparar ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: `${cor}22`, color: cor }}>
              {formatarMes(dados.mes_ref)}
            </span>
            <span style={{ fontSize: 10, color: T.textMuted }}>vs</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: `${T.accentGreen}22`, color: T.accentGreen }}>
              {formatarMes(comparar.mes_ref)}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(14,22,45,0.6)', color: T.textMuted }}>
            {formatarMes(dados.mes_ref)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {Object.entries(dados.kpis).map(([chave, valor]) => {
          const label    = labels[chave] || chave
          const delta    = comparar ? calcularDelta(valor, comparar.kpis[chave]) : null
          const isNumeric = !isNaN(Number(valor)) && valor !== null

          return (
            <div key={chave} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: `1px solid ${T.border}`
            }}>
              <span style={{ fontSize: 12, color: T.textMuted }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {comparar && isNumeric && (
                  <span style={{ fontSize: 11, color: T.textMuted, textDecoration: 'line-through' }}>
                    {formatarValor(chave, comparar.kpis[chave])}
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                  {formatarValor(chave, valor)}
                </span>
                {delta && (
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    padding: '1px 6px', borderRadius: 99,
                    background: `${delta.pct >= 0 ? T.accentGreen : T.accentRed}22`,
                    color:      delta.pct >= 0 ? T.accentGreen : T.accentRed
                  }}>
                    {delta.label}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p style={{ fontSize: 10, color: T.textDim, marginTop: 8 }}>
        Gerado em {new Date(dados.gerado_em.endsWith('Z') ? dados.gerado_em : dados.gerado_em + 'Z')
          .toLocaleDateString('pt-BR')}
      </p>
    </div>
  )
}

function CardVazio({ modulo }: { modulo: string }) {
  const cor = CORES_MODULO[modulo] || T.accentBlue
  return (
    <div style={{
      ...glass(0.35, 20),
      boxShadow: neoShadow,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 100
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: cor, alignSelf: 'flex-start' }}>{modulo}</span>
      <p style={{ fontSize: 12, color: `${T.textMuted}55`, textAlign: 'center', marginTop: 8 }}>
        Sem dados para este mês
      </p>
    </div>
  )
}

export function PainelResultados() {
  const [meses,           setMeses]           = useState<string[]>([])
  const [mesSelecionado,  setMesSel]          = useState('')
  const [dadosMes,        setDadosMes]        = useState<ModuloKPI[]>([])
  const [modoComparar,    setModoComparar]    = useState(false)
  const [mesComparar,     setMesComparar]     = useState('')
  const [dadosComparar,   setDadosComparar]   = useState<ModuloKPI[]>([])
  const [loading,         setLoading]         = useState(false)
  const [loadingComp,     setLoadingComp]     = useState(false)

  const TODOS_MODULOS = Object.keys(CORES_MODULO)

  useEffect(() => {
    axios.get(`${API}/api/dashboard/meses`, { headers: headers() })
      .then(r => {
        setMeses(r.data)
        if (r.data.length > 0) setMesSel(r.data[0])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!mesSelecionado) return
    setLoading(true)
    axios.get(`${API}/api/dashboard/resultados?mes=${mesSelecionado}`, { headers: headers() })
      .then(r => setDadosMes(r.data))
      .catch(() => setDadosMes([]))
      .finally(() => setLoading(false))
  }, [mesSelecionado])

  useEffect(() => {
    if (!mesComparar) { setDadosComparar([]); return }
    setLoadingComp(true)
    axios.get(`${API}/api/dashboard/resultados?mes=${mesComparar}`, { headers: headers() })
      .then(r => setDadosComparar(r.data))
      .catch(() => setDadosComparar([]))
      .finally(() => setLoadingComp(false))
  }, [mesComparar])

  const getDados = (modulo: string, lista: ModuloKPI[]) =>
    lista.find(d => d.modulo === modulo)

  const modulosComDados = modoComparar
    ? TODOS_MODULOS.filter(m => getDados(m, dadosMes) || getDados(m, dadosComparar))
    : TODOS_MODULOS.filter(m => getDados(m, dadosMes))

  const selStyle: React.CSSProperties = {
    borderRadius: 7, fontSize: 12, padding: '5px 10px',
    cursor: 'pointer', outline: 'none', fontFamily: 'inherit',
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 900 }}>

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0 }}>Painel de Resultados</h1>
        <p style={{ fontSize: 12, color: T.textMuted, marginTop: 4, letterSpacing: '0.02em' }}>
          KPIs operacionais por módulo · Filtro e comparação por mês de referência
        </p>
      </div>

      <div style={{
        ...glass(0.35, 20), boxShadow: neoShadow,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        borderRadius: 10, padding: '12px 16px', marginBottom: 24
      }}>
        <span style={{ fontSize: 12, color: T.textMuted, flexShrink: 0 }}>Mês de referência:</span>
        <select
          value={mesSelecionado}
          onChange={e => setMesSel(e.target.value)}
          style={{ ...selStyle, background: T.bg, border: `1px solid ${T.accentBlue}`, color: T.accentBlue }}
        >
          {meses.length === 0 && <option value="">Nenhum mês disponível</option>}
          {meses.map(m => (
            <option key={m} value={m}>{formatarMes(m)}</option>
          ))}
        </select>

        {modoComparar && (
          <>
            <span style={{ fontSize: 12, color: T.textMuted }}>vs</span>
            <select
              value={mesComparar}
              onChange={e => setMesComparar(e.target.value)}
              style={{ ...selStyle, background: T.bg, border: `1px solid ${T.accentGreen}`, color: T.accentGreen }}
            >
              <option value="">Selecione um mês</option>
              {meses.filter(m => m !== mesSelecionado).map(m => (
                <option key={m} value={m}>{formatarMes(m)}</option>
              ))}
            </select>
          </>
        )}

        <button
          onClick={() => { setModoComparar(!modoComparar); setMesComparar(''); setDadosComparar([]) }}
          style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 600,
            color:       modoComparar ? T.accentGreen : T.textMuted,
            background:  modoComparar ? `${T.accentGreen}18` : 'transparent',
            border:      `1px solid ${modoComparar ? T.accentGreen + '44' : T.border}`,
            borderRadius: 7, padding: '5px 14px', cursor: 'pointer'
          }}
        >
          {modoComparar ? '✕ Sair da comparação' : '⇄ Comparar meses'}
        </button>
      </div>

      {loading && (
        <p style={{ fontSize: 13, color: T.textMuted }}>Carregando...</p>
      )}

      {!loading && meses.length === 0 && (
        <div style={{
          ...glass(0.35, 20), boxShadow: neoShadow,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '48px 16px', gap: 12, textAlign: 'center', borderRadius: 12
        }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: T.text }}>Nenhum relatório gerado ainda</p>
          <p style={{ fontSize: 12, color: T.textMuted, maxWidth: 280, lineHeight: 1.6 }}>
            Gere relatórios na Central de Relatórios para visualizar os KPIs aqui.
          </p>
        </div>
      )}

      {!loading && modulosComDados.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {modulosComDados.map(modulo => {
            const dadosA = getDados(modulo, dadosMes)
            const dadosB = modoComparar ? getDados(modulo, dadosComparar) : undefined

            if (!dadosA && dadosB) return <CardVazio key={modulo} modulo={modulo} />
            if (!dadosA) return null

            return <CardModulo key={modulo} dados={dadosA} comparar={dadosB} />
          })}
        </div>
      )}

      {modoComparar && !mesComparar && !loadingComp && dadosMes.length > 0 && (
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: `${T.accentAmber}11`, border: `1px solid ${T.accentAmber}33`,
          borderRadius: 8, fontSize: 12, color: T.accentAmber
        }}>
          ℹ️ Selecione o segundo mês para ativar a comparação e ver os deltas.
        </div>
      )}

    </div>
  )
}
