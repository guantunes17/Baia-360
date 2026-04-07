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
  onEntrarDashboard: () => void
  onEntrarAgenda: () => void
  onEntrarUsuarios: () => void
  onEntrarBaseConhecimento: () => void
  onLogout: () => void
}

export function Hub({
  usuario,
  onEntrarRelatorios,
  onEntrarAtlas,
  onEntrarDashboard,
  onEntrarAgenda,
  onEntrarUsuarios,
  onEntrarBaseConhecimento,
  onLogout
}: Props) {
  const hoje = new Date()
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const dataFormatada = `${diasSemana[hoje.getDay()]}, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`
  const isAdmin = usuario.perfil === 'admin'
  const primeiroNome = usuario.nome.split(' ')[0]

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

  return (
    <div className="min-h-screen" style={{ background: '#0f1117' }}>

      {/* Topbar */}
      <header
        className="flex items-center justify-between px-8 py-4 border-b"
        style={{ background: '#13161f', borderColor: '#2d3148' }}
      >
        <div className="flex items-center gap-3">
          <LogoBaia360 size={32} />
          <div>
            <p className="text-sm font-bold" style={{ color: '#e2e8f0' }}>Baia 360</p>
            <p className="text-xs" style={{ color: '#8892a4' }}>Baia 4 Logística e Transportes</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <span style={{ fontSize: 10, background: '#4f8ef722', color: '#4f8ef7', border: '0.5px solid #4f8ef733', padding: '2px 8px', borderRadius: 4 }}>
              admin
            </span>
          )}
          <span className="text-sm" style={{ color: '#8892a4' }}>{usuario.nome}</span>
          <Button
            variant="outline" size="sm" onClick={onLogout}
            style={{ borderColor: '#2d3148', color: '#8892a4', background: 'transparent' }}
          >
            Sair
          </Button>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex flex-col items-center px-8 py-14 gap-10">

        {/* Saudação */}
        <div className="text-center">
          <div className="w-16 h-1 rounded mx-auto mb-6" style={{ background: '#4f8ef7' }} />
          <h1 className="text-4xl font-bold mb-3" style={{ color: '#e2e8f0' }}>
            Olá, {primeiroNome}! 👋
          </h1>
          <p className="text-sm" style={{ color: '#8892a4' }}>{dataFormatada}</p>
        </div>

        {/* Cards principais */}
        <div style={{ width: '100%', maxWidth: 820, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {cardPrincipal('📊', 'Central de Relatórios', 'Geração e análise de relatórios operacionais e financeiros.', '#4f8ef7', onEntrarRelatorios)}
          {cardPrincipal('🤖', 'Atlas', 'Assistente IA — análises e consultas via linguagem natural.', '#7c3aed', onEntrarAtlas)}
          {cardPrincipal('📈', 'Dashboard', 'KPIs consolidados e histórico de relatórios gerados.', '#4f8ef7', onEntrarDashboard)}
        </div>

        {/* Cards secundários — todos os usuários */}
        <div style={{ width: '100%', maxWidth: 820, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {cardSecundario('📅', 'Agenda', 'Minha agenda pessoal', '#10b981', onEntrarAgenda)}
        </div>

        {/* Seção admin */}
        {isAdmin && (
          <div style={{ width: '100%', maxWidth: 820 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, height: '0.5px', background: '#2d3148' }} />
              <span style={{ fontSize: 10, color: '#4f8ef7', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Administração
              </span>
              <div style={{ flex: 1, height: '0.5px', background: '#2d3148' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              {cardSecundario('👥', 'Usuários', 'Gerenciar acessos e perfis', '#4f8ef7', onEntrarUsuarios)}
              {cardSecundario('🧠', 'Base de Conhecimento', 'Documentos indexados do Atlas', '#7c3aed', onEntrarBaseConhecimento)}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}