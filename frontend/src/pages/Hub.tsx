import { Button } from '@/components/ui/button'
import { LogoBaia360 } from '@/components/LogoBaia360'

interface Usuario {
  id: number
  nome: string
  email: string
  perfil: string
}

interface Props {
  usuario: Usuario
  onEntrarRelatorios: () => void
  onEntrarAtlas: () => void
  onEntrarPainelControle: () => void
  onEntrarPainelResultados: () => void
  onEntrarAgenda: () => void
  onEntrarUsuarios: () => void
  onEntrarBaseConhecimento: () => void
  onEntrarPerfil: () => void
  pendentes?: number
  permissoes?: { hub: string[]; modulos: string[] } | null
  onLogout: () => void
}

export function Hub({
  usuario,
  onEntrarRelatorios,
  onEntrarAtlas,
  onEntrarPainelControle,
  onEntrarPainelResultados,
  onEntrarAgenda,
  onEntrarUsuarios,
  onEntrarBaseConhecimento,
  onEntrarPerfil,
  pendentes = 0,
  permissoes,
  onLogout
}: Props) {
  const hoje = new Date()
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const dataFormatada = `${diasSemana[hoje.getDay()]}, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`

  const perfil = usuario.perfil
  const isAdmin      = perfil === 'admin'
  const temHub = (key: string) => isAdmin || (permissoes != null && permissoes.hub.includes(key))
  const temRelatorios = temHub('central')
  const primeiroNome = usuario.nome.split(' ')[0]

  const badgePerfil: Record<string, { label: string; color: string }> = {
    admin:       { label: 'Admin',       color: '#4f8ef7' },
    analista:    { label: 'Analista',    color: '#7c3aed' },
    financeiro:  { label: 'Financeiro',  color: '#f59e0b' },
    operacional: { label: 'Operacional', color: '#10b981' },
  }
  const bp = badgePerfil[perfil]

  const cardPrincipal = (icone: string, titulo: string, descricao: string, cor: string, onClick: () => void) => (
    <div
      onClick={onClick}
      style={{
        background: '#1a1d27', border: `1px solid ${cor}55`, borderRadius: 12,
        padding: '24px 20px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'all 0.2s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = cor
        el.style.boxShadow = `0 0 20px ${cor}22`
        el.style.transform = 'scale(1.03)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}55`
        el.style.boxShadow = 'none'
        el.style.transform = 'scale(1)'
      }}
    >
      <span style={{ fontSize: 36 }}>{icone}</span>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px' }}>{titulo}</p>
        <p style={{ fontSize: 11, color: '#8892a4', margin: 0 }}>{descricao}</p>
      </div>
    </div>
  )

  const cardSecundario = (icone: string, titulo: string, descricao: string, cor: string, onClick: () => void) => (
    <div
      onClick={onClick}
      style={{
        background: '#1a1d27', border: `1px solid ${cor}44`, borderRadius: 10,
        padding: '16px 14px', display: 'flex', alignItems: 'center',
        gap: 12, cursor: 'pointer', transition: 'all 0.2s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = cor
        el.style.boxShadow = `0 0 16px ${cor}18`
        el.style.transform = 'scale(1.02)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}44`
        el.style.boxShadow = 'none'
        el.style.transform = 'scale(1)'
      }}
    >
      <span style={{ fontSize: 22, flexShrink: 0 }}>{icone}</span>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', margin: '0 0 2px' }}>{titulo}</p>
        <p style={{ fontSize: 10, color: '#8892a4', margin: 0 }}>{descricao}</p>
      </div>
    </div>
  )

  // Número de cards principais visíveis para calcular o grid
  const nCardsPrincipais = [temRelatorios, true, temHub('painel_controle'), temHub('painel_resultados')].filter(Boolean).length
  const gridCols = nCardsPrincipais === 1 ? '1fr' : nCardsPrincipais === 2 ? 'repeat(2,1fr)' : 'repeat(3,1fr)'

  return (
    <div className="min-h-screen" style={{ background: '#0f1117' }}>

      {/* Topbar */}
      <header className="flex items-center justify-between px-8 py-4 border-b" style={{ background: '#13161f', borderColor: '#2d3148' }}>
        <div className="flex items-center gap-3">
          <LogoBaia360 size={32} />
          <div>
            <p className="text-sm font-bold" style={{ color: '#e2e8f0' }}>Baia 360</p>
            <p className="text-xs" style={{ color: '#8892a4' }}>Baia 4 Logística e Transportes</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {bp && (
            <span style={{ fontSize: 10, background: `${bp.color}22`, color: bp.color, border: `0.5px solid ${bp.color}33`, padding: '2px 8px', borderRadius: 4 }}>
              {bp.label}
            </span>
          )}
          <button
            onClick={onEntrarPerfil}
            title="Meu perfil"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 8, transition: 'background .12s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#1a1d27'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
          >
            <span className="text-sm" style={{ color: '#8892a4' }}>{usuario.nome}</span>
          </button>
          <Button variant="outline" size="sm" onClick={onLogout} style={{ borderColor: '#2d3148', color: '#8892a4', background: 'transparent' }}>
            Sair
          </Button>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex flex-col items-center px-8 py-14 gap-10">

        {/* Saudação */}
        <div className="text-center">
          <div className="w-16 h-1 rounded mx-auto mb-6" style={{ background: '#4f8ef7' }} />
          <h1 className="text-4xl font-bold mb-3" style={{ color: '#e2e8f0' }}>Olá, {primeiroNome}! 👋</h1>
          <p className="text-sm" style={{ color: '#8892a4' }}>{dataFormatada}</p>
        </div>

        {/* Cards principais — visíveis por perfil */}
        <div style={{ width: '100%', maxWidth: 820, display: 'grid', gridTemplateColumns: gridCols, gap: 14 }}>
          {temRelatorios && cardPrincipal('📊', 'Central de Relatórios', 'Geração e análise de relatórios.', '#4f8ef7', onEntrarRelatorios)}
          {cardPrincipal('🤖', 'Atlas', 'Assistente IA — análises via linguagem natural.', '#7c3aed', onEntrarAtlas)}
          {temHub('painel_controle') && cardPrincipal('📡', 'Painel de Controle', 'Métricas gerenciais e uso do sistema.', '#4f8ef7', onEntrarPainelControle)}
          {temHub('painel_resultados') && cardPrincipal('📈', 'Painel de Resultados', 'KPIs operacionais por módulo e mês.', '#10b981', onEntrarPainelResultados)}
        </div>

        {/* Agenda — todos os perfis */}
        <div style={{ width: '100%', maxWidth: 820, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
          {temHub('agenda') && cardSecundario('📅', 'Agenda', 'Minha agenda pessoal', '#10b981', onEntrarAgenda)}
        </div>

        {/* Seção admin */}
        {isAdmin && (
          <div style={{ width: '100%', maxWidth: 820 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, height: '0.5px', background: '#2d3148' }} />
              <span style={{ fontSize: 10, color: '#4f8ef7', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Administração</span>
              <div style={{ flex: 1, height: '0.5px', background: '#2d3148' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
              <div style={{ position: 'relative' }}>
                {cardSecundario('👥', 'Usuários', 'Gerenciar acessos e perfis', '#4f8ef7', onEntrarUsuarios)}
                {pendentes > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    background: '#e05252', color: '#fff',
                    fontSize: 10, fontWeight: 700,
                    borderRadius: '50%', minWidth: 18, height: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px', border: '2px solid #0f1117'
                  }}>
                    {pendentes}
                  </span>
                )}
              </div>
              {cardSecundario('🧠', 'Base de Conhecimento', 'Documentos indexados do Atlas', '#7c3aed', onEntrarBaseConhecimento)}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}