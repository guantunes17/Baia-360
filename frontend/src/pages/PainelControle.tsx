import { useEffect, useState } from 'react'
import axios from 'axios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

interface PorModulo { modulo: string; total: number }
interface PorMes    { mes: string;    total: number }
interface Recente   { id: number; modulo: string; mes_ref: string; usuario: string; gerado_em: string; kpis: Record<string, any> }

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

function formatarData(iso: string) {
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function AtlasLogCard() {
  const [logs,     setLogs]     = useState<any[]>([])
  const [metricas, setMetricas] = useState<any>(null)

  useEffect(() => {
    axios.get(`${API}/api/atlas/log_conversas`, { headers: headers() }).then(r => setLogs(r.data)).catch(() => {})
    axios.get(`${API}/api/atlas/metricas`,      { headers: headers() }).then(r => setMetricas(r.data)).catch(() => {})
  }, [])

  if (!metricas && logs.length === 0) return null

  const maxConversas = Math.max(...(metricas?.por_usuario || []).map((u: any) => u.conversas), 1)

  return (
    <div style={{ marginTop: 24 }}>

      {/* Título da seção */}
      <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', paddingLeft: 10, borderLeft: '2px solid #7c3aed', marginBottom: 16 }}>
        Uso do Atlas
      </h2>

      {/* Cards de métricas */}
      {metricas && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Conversas',       valor: metricas.total_conversas, cor: '#7c3aed' },
            { label: 'Mensagens trocadas', valor: metricas.total_msgs,   cor: '#4f8ef7' },
            { label: 'Usuários ativos', valor: metricas.por_usuario?.length || 0, cor: '#10b981' },
            { label: 'Msgs na mais longa', valor: metricas.mais_longa?.total_msgs || 0, cor: '#f59e0b' },
          ].map(card => (
            <div key={card.label} style={{ background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ fontSize: 10, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{card.label}</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: card.cor, lineHeight: 1 }}>{card.valor}</p>
            </div>
          ))}
        </div>
      )}

      {/* Barras por usuário */}
      {metricas?.por_usuario?.length > 0 && (
        <div style={{ background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 10, padding: '16px', marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#8892a4', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conversas por usuário</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {metricas.por_usuario.map((u: any) => (
              <div key={u.nome}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#e2e8f0' }}>{u.nome}</span>
                  <span style={{ color: '#8892a4' }}>{u.conversas} conv · {u.msgs} msgs</span>
                </div>
                <div style={{ background: '#2d3148', borderRadius: 99, height: 6 }}>
                  <div style={{ width: `${(u.conversas / maxConversas) * 100}%`, height: 6, borderRadius: 99, background: '#7c3aed', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log de conversas recentes */}
      {logs.length > 0 && (
        <div style={{ background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 10, padding: '16px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#8892a4', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conversas recentes</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {logs.map((l: any) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1117', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', flexShrink: 0, background: '#7c3aed22', padding: '2px 8px', borderRadius: 99 }}>{l.usuario}</span>
                  <span style={{ fontSize: 12, color: '#8892a4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.primeira_msg || '—'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#8892a4', background: '#2d3148', padding: '2px 8px', borderRadius: 99 }}>{l.total_msgs} msgs</span>
                  <span style={{ fontSize: 11, color: '#8892a455' }}>
                    {new Date(l.criado_em.endsWith('Z') ? l.criado_em : l.criado_em + 'Z').toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

export function PainelControle() {
  const [porModulo,      setPorModulo]      = useState<PorModulo[]>([])
  const [porMes,         setPorMes]         = useState<PorMes[]>([])
  const [recentes,       setRecentes]       = useState<Recente[]>([])
  const [loading,        setLoading]        = useState(true)
  const [erro,           setErro]           = useState('')
  const [isAdmin,        setIsAdmin]        = useState(false)

  useEffect(() => {
    try { const u = JSON.parse(localStorage.getItem('usuario') || '{}'); setIsAdmin(u.perfil === 'admin') } catch {}
    const carregar = async () => {
      try {
        const res = await axios.get(`${API}/api/dashboard`, { headers: headers() })
        setPorModulo(res.data.por_modulo)
        setPorMes(res.data.por_mes)
        setRecentes(res.data.recentes)
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
        <h1 className="text-3xl font-bold" style={{ color: '#e2e8f0' }}>📡 Painel de Controle</h1>
        <p className="text-xs mt-2" style={{ color: '#8892a4', letterSpacing: '0.02em' }}>
          Métricas gerenciais · Uso do sistema · Atlas
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
              <Card key={m.modulo} className="border col-span-2 sm:col-span-1" style={{ background: '#1a1d27', borderColor: '#2d3148', transition: 'transform 0.2s ease, border-color 0.2s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.borderColor = '#4f8ef744' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.borderColor = '#2d3148' }}>
                <CardContent className="p-4">
                  <p style={{ color: '#8892a4', fontSize: '10px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>{m.modulo}</p>
                  <p className="text-3xl font-bold" style={{ color: CORES_MODULO[m.modulo] || '#e2e8f0', lineHeight: 1 }}>{m.total}</p>
                  <p className="text-xs mt-1" style={{ color: '#8892a4' }}>relatórios</p>
                </CardContent>
              </Card>
            ))}
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

          {/* Log Atlas — apenas admin */}
          {isAdmin && <AtlasLogCard />}
        </>
      )}
    </div>
  )
}