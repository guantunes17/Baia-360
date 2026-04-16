import { useState, useEffect } from 'react'
import axios from 'axios'
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
  // Converte YYYY-MM ou MM-YYYY para MM/AAAA
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
  modulo: string
  mes_ref: string
  gerado_em: string
  kpis: Record<string, any>
}

function CardModulo({ dados, comparar }: { dados: ModuloKPI; comparar?: ModuloKPI }) {
  const cor = CORES_MODULO[dados.modulo] || '#4f8ef7'
  const labels = KPI_LABELS[dados.modulo] || {}

  return (
    <div style={{
      background: '#1a1d27',
      border: `1px solid ${cor}44`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: cor }}>{dados.modulo}</span>
        {comparar ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: `${cor}22`, color: cor }}>
              {formatarMes(dados.mes_ref)}
            </span>
            <span style={{ fontSize: 10, color: '#8892a4' }}>vs</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#10b98122', color: '#10b981' }}>
              {formatarMes(comparar.mes_ref)}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#2d3148', color: '#8892a4' }}>
            {formatarMes(dados.mes_ref)}
          </span>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {Object.entries(dados.kpis).map(([chave, valor]) => {
          const label = labels[chave] || chave
          const delta = comparar ? calcularDelta(valor, comparar.kpis[chave]) : null
          const isNumeric = !isNaN(Number(valor)) && valor !== null

          return (
            <div key={chave} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid #2d314855'
            }}>
              <span style={{ fontSize: 12, color: '#8892a4' }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {comparar && isNumeric && (
                  <span style={{ fontSize: 11, color: '#8892a4', textDecoration: 'line-through' }}>
                    {formatarValor(chave, comparar.kpis[chave])}
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                  {formatarValor(chave, valor)}
                </span>
                {delta && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 99,
                    background: delta.pct >= 0 ? '#10b98122' : '#ef444422',
                    color: delta.pct >= 0 ? '#10b981' : '#ef4444'
                  }}>
                    {delta.label}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Gerado em */}
      <p style={{ fontSize: 10, color: '#2d3148', marginTop: 8 }}>
        Gerado em {new Date(dados.gerado_em.endsWith('Z') ? dados.gerado_em : dados.gerado_em + 'Z')
          .toLocaleDateString('pt-BR')}
      </p>
    </div>
  )
}

function CardVazio({ modulo }: { modulo: string }) {
  const cor = CORES_MODULO[modulo] || '#4f8ef7'
  return (
    <div style={{
      background: '#1a1d27',
      border: '1px solid #2d3148',
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
      <p style={{ fontSize: 12, color: '#8892a455', textAlign: 'center', marginTop: 8 }}>
        Sem dados para este mês
      </p>
    </div>
  )
}

export function PainelResultados() {
  const [meses, setMeses]               = useState<string[]>([])
  const [mesSelecionado, setMesSel]     = useState('')
  const [dadosMes, setDadosMes]         = useState<ModuloKPI[]>([])
  const [modoComparar, setModoComparar] = useState(false)
  const [mesComparar, setMesComparar]   = useState('')
  const [dadosComparar, setDadosComparar] = useState<ModuloKPI[]>([])
  const [loading, setLoading]           = useState(false)
  const [loadingComp, setLoadingComp]   = useState(false)

  const TODOS_MODULOS = Object.keys(CORES_MODULO)

  // Carrega lista de meses disponíveis
  useEffect(() => {
    axios.get(`${API}/api/dashboard/meses`, { headers: headers() })
      .then(r => {
        setMeses(r.data)
        if (r.data.length > 0) setMesSel(r.data[0])
      })
      .catch(() => {})
  }, [])

  // Carrega KPIs do mês selecionado
  useEffect(() => {
    if (!mesSelecionado) return
    setLoading(true)
    axios.get(`${API}/api/dashboard/resultados?mes=${mesSelecionado}`, { headers: headers() })
      .then(r => setDadosMes(r.data))
      .catch(() => setDadosMes([]))
      .finally(() => setLoading(false))
  }, [mesSelecionado])

  // Carrega KPIs do mês de comparação
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

  return (
    <div className="p-8 max-w-5xl">

      {/* Cabeçalho */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: '#e2e8f0' }}>📈 Painel de Resultados</h1>
        <p className="text-xs mt-2" style={{ color: '#8892a4', letterSpacing: '0.02em' }}>
          KPIs operacionais por módulo · Filtro e comparação por mês de referência
        </p>
      </div>

      {/* Barra de filtros */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 10,
        padding: '12px 16px', marginBottom: 24
      }}>
        <span style={{ fontSize: 12, color: '#8892a4', flexShrink: 0 }}>Mês de referência:</span>
        <select
          value={mesSelecionado}
          onChange={e => setMesSel(e.target.value)}
          style={{
            background: '#0f1117', border: '1px solid #4f8ef7', borderRadius: 7,
            color: '#4f8ef7', fontSize: 12, padding: '5px 10px', cursor: 'pointer'
          }}
        >
          {meses.length === 0 && <option value="">Nenhum mês disponível</option>}
          {meses.map(m => (
            <option key={m} value={m}>{formatarMes(m)}</option>
          ))}
        </select>

        {modoComparar && (
          <>
            <span style={{ fontSize: 12, color: '#8892a4' }}>vs</span>
            <select
              value={mesComparar}
              onChange={e => setMesComparar(e.target.value)}
              style={{
                background: '#0f1117', border: '1px solid #10b981', borderRadius: 7,
                color: '#10b981', fontSize: 12, padding: '5px 10px', cursor: 'pointer'
              }}
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
            color: modoComparar ? '#10b981' : '#8892a4',
            background: modoComparar ? '#10b98118' : 'transparent',
            border: `1px solid ${modoComparar ? '#10b98144' : '#2d3148'}`,
            borderRadius: 7, padding: '5px 14px', cursor: 'pointer'
          }}
        >
          {modoComparar ? '✕ Sair da comparação' : '⇄ Comparar meses'}
        </button>
      </div>

      {/* Estado de carregamento */}
      {loading && (
        <p style={{ fontSize: 13, color: '#8892a4' }}>Carregando...</p>
      )}

      {/* Sem dados */}
      {!loading && meses.length === 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '48px 16px', gap: 12, textAlign: 'center',
          background: '#1a1d27', borderRadius: 12, border: '1px solid #2d3148'
        }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0' }}>Nenhum relatório gerado ainda</p>
          <p style={{ fontSize: 12, color: '#8892a4', maxWidth: 280, lineHeight: 1.6 }}>
            Gere relatórios na Central de Relatórios para visualizar os KPIs aqui.
          </p>
        </div>
      )}

      {/* Grid de módulos */}
      {!loading && modulosComDados.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 12
        }}>
          {modulosComDados.map(modulo => {
            const dadosA = getDados(modulo, dadosMes)
            const dadosB = modoComparar ? getDados(modulo, dadosComparar) : undefined

            if (!dadosA && dadosB) return <CardVazio key={modulo} modulo={modulo} />
            if (!dadosA) return null

            return (
              <CardModulo
                key={modulo}
                dados={dadosA}
                comparar={dadosB}
              />
            )
          })}
        </div>
      )}

      {/* Modo comparativo sem mês B selecionado */}
      {modoComparar && !mesComparar && !loadingComp && dadosMes.length > 0 && (
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: '#f59e0b11', border: '1px solid #f59e0b33',
          borderRadius: 8, fontSize: 12, color: '#f59e0b'
        }}>
          ℹ️ Selecione o segundo mês para ativar a comparação e ver os deltas.
        </div>
      )}

    </div>
  )
}