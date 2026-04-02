import { useEffect, useState } from 'react'
import axios from 'axios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const API = 'http://localhost:5001'
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

interface PorModulo { modulo: string; total: number }
interface PorMes    { mes: string;    total: number }
interface Recente   { id: number; modulo: string; mes_ref: string; usuario: string; gerado_em: string; kpis: Record<string, any> }
interface KpiModulo { mes_ref: string | null; gerado_em: string; kpis: Record<string, any> }

const CORES_MODULO: Record<string, string> = {
  'Fretes':           '#7c3aed',
  'Armazenagem':      '#10b981',
  'Pedidos':          '#4f8ef7',
  'Recebimentos':     '#0891b2',
  'Cap. Operacional': '#e11d48',
  'Estoque':          '#f59e0b',
  'Fat. Distribuição':'#ea580c',
  'Fat. Armazenagem': '#7c3aed',
}

const KPI_LABELS: Record<string, Record<string, string>> = {
  'Pedidos':          { total_ordens: 'Total Ordens', sla_pct: 'SLA %', excedidas: 'Excedidas' },
  'Fretes':           { total_frete: 'Custo Total (R$)', remetentes: 'Remetentes' },
  'Armazenagem':      { total_armazenagem: 'Faturamento (R$)', clientes: 'Clientes' },
  'Estoque':          { clientes: 'Clientes', maior_pico_m3: 'Maior Pico m³', maior_pico_cliente: 'Top Cliente' },
  'Recebimentos':     { total_recebimentos: 'Total Recebimentos', valor_total: 'Valor Total (R$)', depositantes: 'Depositantes' },
  'Fat. Distribuição':{ total_frete: 'Total Fretes (R$)', clientes: 'Clientes' },
  'Fat. Armazenagem': { total_faturamento: 'Faturamento (R$)', clientes: 'Clientes' },
  'Cap. Operacional': { total_os: 'Total OS', depositantes: 'Depositantes' },
}

function formatarData(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatarValor(chave: string, valor: any): string {
  if (valor === undefined || valor === null) return '—'
  if (chave.includes('frete') || chave.includes('armazenagem') || chave.includes('faturamento') || chave.includes('valor'))
    return `R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  if (chave === 'sla_pct')
    return `${Number(valor).toFixed(1)}%`
  if (chave.includes('m3'))
    return `${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m³`
  if (chave === 'maior_pico_cliente')
    return String(valor)
  return String(valor)
}

export function DashboardPage() {
  const [porModulo,      setPorModulo]      = useState<PorModulo[]>([])
  const [porMes,         setPorMes]         = useState<PorMes[]>([])
  const [recentes,       setRecentes]       = useState<Recente[]>([])
  const [kpisPorModulo,  setKpisPorModulo]  = useState<Record<string, KpiModulo>>({})
  const [loading,        setLoading]        = useState(true)
  const [erro,           setErro]           = useState('')

  useEffect(() => {
    const carregar = async () => {
      try {
        const res = await axios.get(`${API}/api/dashboard`, { headers: headers() })
        setPorModulo(res.data.por_modulo)
        setPorMes(res.data.por_mes)
        setRecentes(res.data.recentes)
        setKpisPorModulo(res.data.kpis_por_modulo || {})
      } catch {
        setErro('Erro ao carregar dados do dashboard')
      } finally {
        setLoading(false)
      }
    }
    carregar()
  }, [])

  const totalGeral = porModulo.reduce((acc, m) => acc + m.total, 0)
  const maxTotal   = Math.max(...porModulo.map(m => m.total), 1)

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: '#e2e8f0' }}>📈 Dashboard</h1>
        <p className="text-xs mt-2" style={{ color: '#8892a4', letterSpacing: '0.02em' }}>
          KPIs operacionais · Histórico de relatórios gerados
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: '#8892a4' }}>Carregando...</p>}
      {erro    && <p className="text-sm" style={{ color: '#ef4444' }}>{erro}</p>}

      {!loading && !erro && (
        <>
          {/* Total geral */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <Card className="border col-span-2 sm:col-span-1" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
              <CardContent className="p-4">
                <p style={{ color: '#8892a4', fontSize: '10px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>Total gerado</p>
                <p className="text-3xl font-bold" style={{ color: '#4f8ef7', lineHeight: 1 }}>{totalGeral}</p>
                <p className="text-xs mt-1" style={{ color: '#8892a4' }}>relatórios</p>
              </CardContent>
            </Card>
            {porModulo.slice(0, 3).map(m => (
              <Card key={m.modulo} className="border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
                <CardContent className="p-4">
                  <p style={{ color: '#8892a4', fontSize: '10px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>{m.modulo}</p>
                  <p className="text-3xl font-bold" style={{ color: CORES_MODULO[m.modulo] || '#e2e8f0', lineHeight: 1 }}>{m.total}</p>
                  <p className="text-xs mt-1" style={{ color: '#8892a4' }}>relatórios</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* KPIs por módulo */}
          <div className="mb-8">
            <h2 className="text-base font-semibold mb-4" style={{ color: '#e2e8f0', paddingLeft: '10px', borderLeft: '2px solid #4f8ef7' }}>
              KPIs do último relatório
            </h2>
            {Object.keys(kpisPorModulo).length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: '10px', textAlign: 'center', background: '#1a1d27', borderRadius: '12px', border: '0.5px solid #2d3148' }}>
                <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ opacity: 0.25, marginBottom: '4px' }}>
                  <circle cx="22" cy="22" r="14" stroke="#4f8ef7" strokeWidth="2" fill="none"/>
                  <line x1="22" y1="15" x2="22" y2="23" stroke="#4f8ef7" strokeWidth="2.5" strokeLinecap="round"/>
                  <circle cx="22" cy="28" r="1.5" fill="#4f8ef7"/>
                </svg>
                <p style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0' }}>Nenhum KPI disponível</p>
                <p style={{ fontSize: '12px', color: '#8892a4', maxWidth: '260px', lineHeight: 1.5 }}>Gere relatórios nos módulos para visualizar os KPIs mais recentes aqui.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(kpisPorModulo).map(([modulo, dados]) => {
                  const labels = KPI_LABELS[modulo] || {}
                  const cor    = CORES_MODULO[modulo] || '#4f8ef7'
                  return (
                    <Card key={modulo} className="border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold" style={{ color: cor }}>
                            {modulo}
                          </CardTitle>
                          {dados.mes_ref && (
                            <Badge variant="outline" style={{ borderColor: '#2d3148', color: '#8892a4', fontSize: '10px' }}>
                              {dados.mes_ref}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 space-y-2">
                        {Object.entries(dados.kpis).map(([chave, valor]) => (
                          <div key={chave} className="flex justify-between items-center">
                            <span className="text-xs" style={{ color: '#8892a4' }}>
                              {labels[chave] || chave}
                            </span>
                            <span className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>
                              {formatarValor(chave, valor)}
                            </span>
                          </div>
                        ))}
                        <p className="text-xs pt-1" style={{ color: '#2d3148' }}>
                          {formatarData(dados.gerado_em)}
                        </p>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* Barras por módulo */}
          <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
            <CardHeader>
              <CardTitle className="text-base font-semibold" style={{ color: '#e2e8f0', paddingLeft: '10px', borderLeft: '2px solid #4f8ef7' }}>Relatórios por módulo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {porModulo.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: '10px', textAlign: 'center' }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ opacity: 0.25, marginBottom: '4px' }}>
                    <rect x="6" y="28" width="7" height="10" rx="2" fill="#4f8ef7"/>
                    <rect x="18" y="20" width="7" height="18" rx="2" fill="#4f8ef7"/>
                    <rect x="30" y="14" width="7" height="24" rx="2" fill="#4f8ef7"/>
                  </svg>
                  <p style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0' }}>Nenhum relatório gerado ainda</p>
                  <p style={{ fontSize: '12px', color: '#8892a4', maxWidth: '260px', lineHeight: 1.5 }}>Gere seu primeiro relatório em qualquer módulo da Central de Relatórios.</p>
                </div>
              ) : (
                porModulo.map(m => (
                  <div key={m.modulo}>
                    <div className="flex justify-between text-xs mb-1" style={{ color: '#8892a4' }}>
                      <span>{m.modulo}</span>
                      <span>{m.total}</span>
                    </div>
                    <div className="w-full rounded-full h-2" style={{ background: '#2d3148' }}>
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{ width: `${(m.total / maxTotal) * 100}%`, background: CORES_MODULO[m.modulo] || '#4f8ef7' }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Evolução mensal */}
          <Card className="mb-6 border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
            <CardHeader>
              <CardTitle className="text-base font-semibold" style={{ color: '#e2e8f0', paddingLeft: '10px', borderLeft: '2px solid #4f8ef7' }}>Evolução mensal</CardTitle>
            </CardHeader>
            <CardContent>
              {porMes.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: '10px', textAlign: 'center' }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ opacity: 0.25, marginBottom: '4px' }}>
                    <polyline points="6,34 16,22 24,26 36,12" stroke="#4f8ef7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    <circle cx="36" cy="12" r="3" fill="#4f8ef7"/>
                  </svg>
                  <p style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0' }}>Sem dados mensais</p>
                  <p style={{ fontSize: '12px', color: '#8892a4', maxWidth: '260px', lineHeight: 1.5 }}>A evolução aparecerá após relatórios de meses diferentes serem gerados.</p>
                </div>
              ) : (
                <div className="flex items-end gap-3 h-32">
                  {porMes.map(m => {
                    const maxMes = Math.max(...porMes.map(x => x.total), 1)
                    const altura = Math.max((m.total / maxMes) * 100, 8)
                    return (
                      <div key={m.mes || 'sem-mes'} className="flex flex-col items-center flex-1 gap-1">
                        <span className="text-xs" style={{ color: '#4f8ef7' }}>{m.total}</span>
                        <div className="w-full rounded-t" style={{ height: `${altura}%`, background: '#4f8ef7', minHeight: '8px' }} />
                        <span className="text-xs" style={{ color: '#8892a4' }}>{m.mes || '—'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Últimas gerações */}
          <Card className="border" style={{ background: '#1a1d27', borderColor: '#2d3148' }}>
            <CardHeader>
              <CardTitle className="text-base font-semibold" style={{ color: '#e2e8f0', paddingLeft: '10px', borderLeft: '2px solid #4f8ef7' }}>Últimas gerações</CardTitle>
            </CardHeader>
            <CardContent>
              {recentes.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: '10px', textAlign: 'center' }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ opacity: 0.25, marginBottom: '4px' }}>
                    <rect x="8" y="10" width="28" height="4" rx="2" fill="#4f8ef7"/>
                    <rect x="8" y="20" width="20" height="4" rx="2" fill="#4f8ef7"/>
                    <rect x="8" y="30" width="24" height="4" rx="2" fill="#4f8ef7"/>
                  </svg>
                  <p style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0' }}>Histórico vazio</p>
                  <p style={{ fontSize: '12px', color: '#8892a4', maxWidth: '260px', lineHeight: 1.5 }}>As gerações de relatórios aparecerão aqui conforme forem realizadas.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentes.map(r => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: '#0f1117' }}>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" style={{ borderColor: CORES_MODULO[r.modulo] || '#2d3148', color: CORES_MODULO[r.modulo] || '#e2e8f0', fontSize: '11px' }}>
                          {r.modulo}
                        </Badge>
                        <span className="text-xs" style={{ color: '#8892a4' }}>{r.mes_ref || '—'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: '#8892a4' }}>
                        <span>{r.usuario}</span>
                        <span>{formatarData(r.gerado_em)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}