import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { MODULOS } from '@/lib/constants'
import { HomeCard } from '@/components/HomeCard'
import { LayoutDashboard, DollarSign, Lightbulb } from 'lucide-react'

interface Props {
  onNavegar: (key: string) => void
  modulosPermitidos?: string[]
}

const hoje = new Date()
const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const dataFormatada = `${diasSemana[hoje.getDay()]}, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`

export function Home({ onNavegar, modulosPermitidos }: Props) {
  const operacional = MODULOS.filter(m =>
    m.grupo === 'operacional' && (!modulosPermitidos || modulosPermitidos.includes(m.key))
  )
  const financeiro = MODULOS.filter(m =>
    m.grupo === 'financeiro' && (!modulosPermitidos || modulosPermitidos.includes(m.key))
  )

  return (
    <div style={{ padding: 32 }}>

      {/* Cabeçalho */}
      <div style={{ marginBottom: 32 }}>
        <div style={{
          width: 48, height: 2, borderRadius: 1, marginBottom: 16,
          background: `linear-gradient(90deg, ${T.gold}, transparent)`,
        }} />
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: '0 0 6px' }}>
          Painel Principal
        </h1>
        <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Hoje: {dataFormatada}</p>
      </div>

      {/* Grupo Operacional */}
      {operacional.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <LayoutDashboard size={14} color={T.accentBlue} />
            <h2 style={{
              fontSize: 11, fontWeight: 700, color: T.accentBlue,
              textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0,
            }}>
              Operacional
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {operacional.map(m => (
              <HomeCard
                key={m.key}
                lucideIcon={m.lucideIcon}
                icone={m.icone}
                titulo={m.titulo}
                descricao={m.descricao}
                cor={m.cor}
                onAcessar={() => onNavegar(m.key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Grupo Financeiro */}
      {financeiro.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <DollarSign size={14} color={T.accentGreen} />
            <h2 style={{
              fontSize: 11, fontWeight: 700, color: T.accentGreen,
              textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0,
            }}>
              Financeiro
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {financeiro.map(m => (
              <HomeCard
                key={m.key}
                lucideIcon={m.lucideIcon}
                icone={m.icone}
                titulo={m.titulo}
                descricao={m.descricao}
                cor={m.cor}
                onAcessar={() => onNavegar(m.key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Dica */}
      <div style={{
        ...glass(0.25, 16),
        boxShadow: neoShadow,
        borderRadius: 12,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <Lightbulb size={16} color={T.gold} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: T.textMuted }}>
          Clique em qualquer módulo para gerar relatórios, ou use a barra lateral para navegar.
        </span>
      </div>

    </div>
  )
}
