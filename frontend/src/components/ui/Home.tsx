import { MODULOS } from '@/lib/constants'
import { HomeCard } from '@/components/HomeCard'

interface Props {
  onNavegar: (key: string) => void
}

const hoje = new Date()
const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const dataFormatada = `${diasSemana[hoje.getDay()]}, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`

export function Home({ onNavegar }: Props) {
  const operacional = MODULOS.filter(m => m.grupo === 'operacional')
  const financeiro  = MODULOS.filter(m => m.grupo === 'financeiro')

  return (
    <div className="p-8">
      {/* Cabeçalho */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>
          🏠 Painel Principal
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8892a4' }}>
          Hoje: {dataFormatada}
        </p>
      </div>

      {/* Grupo Operacional */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider" style={{ color: '#4f8ef7' }}>
          📊 Operacional
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {operacional.map(m => (
            <HomeCard
              key={m.key}
              icone={m.icone}
              titulo={m.titulo}
              descricao={m.descricao}
              cor={m.cor}
              onAcessar={() => onNavegar(m.key)}
            />
          ))}
        </div>
      </div>

      {/* Grupo Financeiro */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold mb-4 uppercase tracking-wider" style={{ color: '#10b981' }}>
          💰 Financeiro
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {financeiro.map(m => (
            <HomeCard
              key={m.key}
              icone={m.icone}
              titulo={m.titulo}
              descricao={m.descricao}
              cor={m.cor}
              onAcessar={() => onNavegar(m.key)}
            />
          ))}
        </div>
      </div>

      {/* Dica */}
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ background: '#1a1d27', borderColor: '#2d3148', color: '#8892a4' }}
      >
        💡 Clique em qualquer módulo para gerar relatórios, ou use a barra lateral para navegar.
      </div>
    </div>
  )
}