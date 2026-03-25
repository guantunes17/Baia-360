import { Badge } from '@/components/ui/badge'

interface Props {
  icone: string
  titulo: string
  descricao: string
  cor: string
  ultimaExtracao?: string
  onAcessar: () => void
}

export function HomeCard({ icone, titulo, descricao, cor, ultimaExtracao, onAcessar }: Props) {
  return (
    <div
      className="rounded-lg border cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
      style={{ background: '#1a1d27', borderColor: '#2d3148' }}
      onClick={onAcessar}
    >
      {/* Barra colorida no topo */}
      <div className="h-1 rounded-t-lg" style={{ background: cor }} />

      <div className="p-5">
        {/* Ícone e título */}
        <div className="flex flex-col items-center text-center gap-2 mb-4">
          <span className="text-4xl">{icone}</span>
          <h3 className="font-bold text-sm leading-tight" style={{ color: '#e2e8f0' }}>
            {titulo}
          </h3>
          <p className="text-xs" style={{ color: '#8892a4' }}>
            {descricao}
          </p>
        </div>

        {/* Separador */}
        <div className="h-px my-3" style={{ background: '#2d3148' }} />

        {/* Última extração */}
        <div className="flex justify-between items-center text-xs">
          <span style={{ color: '#8892a4' }}>Última extração</span>
          <Badge
            variant="outline"
            className="text-xs"
            style={{
              borderColor: ultimaExtracao && ultimaExtracao !== '—' ? cor : '#2d3148',
              color: ultimaExtracao && ultimaExtracao !== '—' ? cor : '#8892a4',
            }}
          >
            {ultimaExtracao || '—'}
          </Badge>
        </div>
      </div>
    </div>
  )
}