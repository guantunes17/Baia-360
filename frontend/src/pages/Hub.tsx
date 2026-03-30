import { Button } from '@/components/ui/button'

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
  onLogout: () => void
}

const produtos = [
  {
    icone: '📊',
    nome: 'Central de Relatórios',
    descricao: 'Geração e análise de relatórios operacionais e financeiros.',
    cor: '#4f8ef7',
    disponivel: true,
  },
  {
    icone: '🤖',
    nome: 'Atlas',
    descricao: 'Assistente IA — agendador de tarefas e análises via linguagem natural.',
    cor: '#7c3aed',
    disponivel: true,
  },
  {
    icone: '📅',
    nome: 'Agenda',
    descricao: 'Agenda sincronizada com o Outlook. Gerenciada pelo Assistente IA.',
    cor: '#10b981',
    disponivel: false,
  },
]

export function Hub({ usuario, onEntrarRelatorios, onEntrarAtlas, onLogout }: Props) {
  const hoje = new Date()
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const dataFormatada = `${diasSemana[hoje.getDay()]}, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`

  return (
    <div className="min-h-screen" style={{ background: '#0f1117' }}>

      {/* Topbar */}
      <header
        className="flex items-center justify-between px-8 py-4 border-b"
        style={{ background: '#13161f', borderColor: '#2d3148' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏢</span>
          <div>
            <p className="text-sm font-bold" style={{ color: '#e2e8f0' }}>Baia 360</p>
            <p className="text-xs" style={{ color: '#8892a4' }}>Baia 4 Logística e Transportes</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: '#8892a4' }}>{usuario.nome}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            style={{ borderColor: '#2d3148', color: '#8892a4', background: 'transparent' }}
          >
            Sair
          </Button>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex flex-col items-center justify-center px-8 py-16">

        {/* Saudação */}
        <div className="text-center mb-12">
          <div className="w-16 h-1 rounded mx-auto mb-6" style={{ background: '#4f8ef7' }} />
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#e2e8f0' }}>
            Olá, {usuario.nome.split(' ')[0]}! 👋
          </h1>
          <p className="text-sm" style={{ color: '#8892a4' }}>{dataFormatada}</p>
          <p className="text-sm mt-1" style={{ color: '#8892a4' }}>
            Selecione um módulo para começar.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl">
          {produtos.map(p => (
            <div
              key={p.nome}
              onClick={p.nome === 'Central de Relatórios' ? onEntrarRelatorios : p.nome === 'Atlas' ? onEntrarAtlas : undefined}
              className="rounded-xl border p-8 flex flex-col items-center text-center gap-4 transition-all"
              style={{
                background: '#1a1d27',
                borderColor: p.disponivel ? p.cor + '55' : '#2d3148',
                cursor: p.disponivel ? 'pointer' : 'not-allowed',
                opacity: p.disponivel ? 1 : 0.5,
                boxShadow: p.disponivel ? `0 0 0 0 ${p.cor}` : 'none',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                if (p.disponivel) {
                  (e.currentTarget as HTMLElement).style.borderColor = p.cor
                  ;(e.currentTarget as HTMLElement).style.boxShadow = `0 0 20px ${p.cor}22`
                }
              }}
              onMouseLeave={e => {
                if (p.disponivel) {
                  (e.currentTarget as HTMLElement).style.borderColor = p.cor + '55'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                }
              }}
            >
              <span className="text-5xl">{p.icone}</span>
              <div>
                <p className="text-lg font-bold mb-1" style={{ color: p.disponivel ? '#e2e8f0' : '#8892a4' }}>
                  {p.nome}
                </p>
                <p className="text-sm" style={{ color: '#8892a4' }}>{p.descricao}</p>
              </div>
              {!p.disponivel && (
                <span
                  className="text-xs px-3 py-1 rounded-full"
                  style={{ background: '#2d3148', color: '#8892a4' }}
                >
                  em breve
                </span>
              )}
            </div>
          ))}
        </div>

      </main>
    </div>
  )
}