import { useEffect, useState } from 'react'
import axios from 'axios'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { API } from '../config'

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

interface PorModulo { modulo: string; total: number }
interface PorMes    { mes: string;    total: number }
interface Recente   { id: number; modulo: string; mes_ref: string; usuario: string; gerado_em: string; kpis: Record<string, any> }

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
      <h2 style={{ fontSize: 15, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentPurple}`, marginBottom: 16 }}>
        Uso do Atlas
      </h2>

      {metricas && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Conversas',          valor: metricas.total_conversas,              cor: T.accentPurple },
            { label: 'Mensagens trocadas', valor: metricas.total_msgs,                   cor: T.accentBlue   },
            { label: 'Usuários ativos',    valor: metricas.por_usuario?.length || 0,     cor: T.accentGreen  },
            { label: 'Msgs na mais longa', valor: metricas.mais_longa?.total_msgs || 0,  cor: T.accentAmber  },
          ].map(card => (
            <div key={card.label} style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{card.label}</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: card.cor, lineHeight: 1 }}>{card.valor}</p>
            </div>
          ))}
        </div>
      )}

      {metricas?.por_usuario?.length > 0 && (
        <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conversas por usuário</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {metricas.por_usuario.map((u: any) => (
              <div key={u.nome}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: T.text }}>{u.nome}</span>
                  <span style={{ color: T.textMuted }}>{u.conversas} conv · {u.msgs} msgs</span>
                </div>
                <div style={{ background: 'rgba(14,22,45,0.8)', borderRadius: 99, height: 6 }}>
                  <div style={{ width: `${(u.conversas / maxConversas) * 100}%`, height: 6, borderRadius: 99, background: T.accentPurple, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 10, padding: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conversas recentes</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {logs.map((l: any) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(8,11,20,0.7)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.accentPurple, flexShrink: 0, background: `${T.accentPurple}22`, padding: '2px 8px', borderRadius: 99 }}>{l.usuario}</span>
                  <span style={{ fontSize: 12, color: T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.primeira_msg || '—'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: T.textMuted, background: 'rgba(14,22,45,0.6)', padding: '2px 8px', borderRadius: 99 }}>{l.total_msgs} msgs</span>
                  <span style={{ fontSize: 11, color: `${T.textMuted}55` }}>
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
  const [porModulo, setPorModulo] = useState<PorModulo[]>([])
  const [porMes,    setPorMes]    = useState<PorMes[]>([])
  const [recentes,  setRecentes]  = useState<Recente[]>([])
  const [loading,   setLoading]   = useState(true)
  const [erro,      setErro]      = useState('')
  const [isAdmin,   setIsAdmin]   = useState(false)

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
    <div style={{ padding: '32px 40px', maxWidth: 900 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0 }}>Painel de Controle</h1>
        <p style={{ fontSize: 12, color: T.textMuted, marginTop: 4, letterSpacing: '0.02em' }}>
          Métricas gerenciais · Uso do sistema · Atlas
        </p>
      </div>

      {loading && <p style={{ fontSize: 13, color: T.textMuted }}>Carregando...</p>}
      {erro    && <p style={{ fontSize: 13, color: T.accentRed }}>{erro}</p>}

      {!loading && !erro && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 12, padding: '16px 20px', gridColumn: 'span 1' }}>
              <p style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Total gerado</p>
              <p style={{ fontSize: 32, fontWeight: 700, color: T.accentBlue, lineHeight: 1 }}>{totalGeral}</p>
              <p style={{ fontSize: 11, marginTop: 4, color: T.textMuted }}>relatórios</p>
            </div>
            {porModulo.slice(0, 3).map(m => (
              <div key={m.modulo}
                style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 12, padding: '16px 20px', transition: 'transform 0.2s ease, border-color 0.2s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.borderColor = `${T.accentBlue}44` }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.borderColor = T.border }}
              >
                <p style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{m.modulo}</p>
                <p style={{ fontSize: 32, fontWeight: 700, color: CORES_MODULO[m.modulo] || T.text, lineHeight: 1 }}>{m.total}</p>
                <p style={{ fontSize: 11, marginTop: 4, color: T.textMuted }}>relatórios</p>
              </div>
            ))}
          </div>

          <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentBlue}` }}>Relatórios por módulo</span>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {porModulo.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: 10, textAlign: 'center' }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ opacity: 0.25, marginBottom: 4 }}>
                    <rect x="6" y="28" width="7" height="10" rx="2" fill={T.accentBlue}/>
                    <rect x="18" y="20" width="7" height="18" rx="2" fill={T.accentBlue}/>
                    <rect x="30" y="14" width="7" height="24" rx="2" fill={T.accentBlue}/>
                  </svg>
                  <p style={{ fontSize: 14, fontWeight: 500, color: T.text }}>Nenhum relatório gerado ainda</p>
                  <p style={{ fontSize: 12, color: T.textMuted, maxWidth: 260, lineHeight: 1.5 }}>Gere seu primeiro relatório em qualquer módulo da Central de Relatórios.</p>
                </div>
              ) : (
                porModulo.map(m => (
                  <div key={m.modulo}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, color: T.textMuted }}>
                      <span>{m.modulo}</span>
                      <span>{m.total}</span>
                    </div>
                    <div style={{ width: '100%', borderRadius: 99, height: 6, background: 'rgba(14,22,45,0.8)' }}>
                      <div style={{ width: `${(m.total / maxTotal) * 100}%`, height: 6, borderRadius: 99, background: CORES_MODULO[m.modulo] || T.accentBlue, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentBlue}` }}>Evolução mensal</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {porMes.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: 10, textAlign: 'center' }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ opacity: 0.25, marginBottom: 4 }}>
                    <polyline points="6,34 16,22 24,26 36,12" stroke={T.accentBlue} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    <circle cx="36" cy="12" r="3" fill={T.accentBlue}/>
                  </svg>
                  <p style={{ fontSize: 14, fontWeight: 500, color: T.text }}>Sem dados mensais</p>
                  <p style={{ fontSize: 12, color: T.textMuted, maxWidth: 260, lineHeight: 1.5 }}>A evolução aparecerá após relatórios de meses diferentes serem gerados.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 128 }}>
                  {porMes.map(m => {
                    const maxMes = Math.max(...porMes.map(x => x.total), 1)
                    const altura = Math.max((m.total / maxMes) * 100, 8)
                    return (
                      <div key={m.mes || 'sem-mes'} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 4 }}>
                        <span style={{ fontSize: 12, color: T.accentBlue }}>{m.total}</span>
                        <div style={{ width: '100%', borderRadius: '4px 4px 0 0', height: `${altura}%`, background: T.accentBlue, minHeight: 8 }} />
                        <span style={{ fontSize: 11, color: T.textMuted }}>{m.mes || '—'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ ...glass(0.35, 20), boxShadow: neoShadow, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text, paddingLeft: 10, borderLeft: `2px solid ${T.accentBlue}` }}>Últimas gerações</span>
            </div>
            <div style={{ padding: '12px 20px' }}>
              {recentes.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: 10, textAlign: 'center' }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ opacity: 0.25, marginBottom: 4 }}>
                    <rect x="8" y="10" width="28" height="4" rx="2" fill={T.accentBlue}/>
                    <rect x="8" y="20" width="20" height="4" rx="2" fill={T.accentBlue}/>
                    <rect x="8" y="30" width="24" height="4" rx="2" fill={T.accentBlue}/>
                  </svg>
                  <p style={{ fontSize: 14, fontWeight: 500, color: T.text }}>Histórico vazio</p>
                  <p style={{ fontSize: 12, color: T.textMuted, maxWidth: 260, lineHeight: 1.5 }}>As gerações de relatórios aparecerão aqui conforme forem realizadas.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {recentes.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8, padding: '8px 12px', background: 'rgba(8,11,20,0.5)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 10px', borderRadius: 99, border: `1px solid ${(CORES_MODULO[r.modulo] || T.accentBlue) + '44'}`, color: CORES_MODULO[r.modulo] || T.text }}>
                          {r.modulo}
                        </span>
                        <span style={{ fontSize: 12, color: T.textMuted }}>{r.mes_ref || '—'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: T.textMuted }}>
                        <span>{r.usuario}</span>
                        <span>{formatarData(r.gerado_em)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isAdmin && <AtlasLogCard />}
        </>
      )}
    </div>
  )
}
