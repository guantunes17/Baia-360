import { T } from './theme'

export const MODULOS = [
  {
    key: 'pedidos',
    icone: '📦',
    lucideIcon: 'Package',
    titulo: 'Pedidos e Recebimentos',
    descricao: 'Análise de SLA · D+0 · D+1 · Excedidos',
    cor: '#4f8ef7',
    grupo: 'operacional',
  },
  {
    key: 'fretes',
    icone: '🚚',
    lucideIcon: 'Truck',
    titulo: 'Fretes',
    descricao: 'Embarques · RESCOM · Portadores · Insumos',
    cor: '#7c3aed',
    grupo: 'operacional',
  },
  {
    key: 'armazenagem',
    icone: '🏭',
    lucideIcon: 'Warehouse',
    titulo: 'Armazenagem',
    descricao: 'Faturamento mensal por cliente',
    cor: '#10b981',
    grupo: 'operacional',
  },
  {
    key: 'estoque',
    icone: '📋',
    lucideIcon: 'ClipboardList',
    titulo: 'Estoque',
    descricao: 'Volume ocupado · Ociosidade por cliente',
    cor: '#f59e0b',
    grupo: 'operacional',
  },
  {
    key: 'produtividade',
    icone: '👥',
    lucideIcon: 'Users',
    titulo: 'Produtividade de Equipe',
    descricao: 'Utilização · Ociosidade · Ranking por etapa',
    cor: '#06b6d4',
    grupo: 'operacional',
  },
  {
    key: 'cap_operacional',
    icone: '⚙️',
    lucideIcon: 'Activity',
    titulo: 'Capacidade Operacional',
    descricao: 'OS por depositante · SKUs · Extração do ESL',
    cor: '#e11d48',
    grupo: 'operacional',
  },
  {
    key: 'recebimentos',
    icone: '📥',
    lucideIcon: 'PackageOpen',
    titulo: 'Recebimentos e Devoluções',
    descricao: 'Entradas · Devoluções · Retiradas por depositante',
    cor: '#0891b2',
    grupo: 'operacional',
  },
  {
    key: 'fat_dist',
    icone: '🚛',
    lucideIcon: 'Receipt',
    titulo: 'Faturamento Distribuição',
    descricao: 'Geral · EPH · Pint Pharma · Funcional',
    cor: '#ea580c',
    grupo: 'financeiro',
  },
  {
    key: 'fat_arm',
    icone: '🏭',
    lucideIcon: 'BarChart3',
    titulo: 'Faturamento Armazenagem',
    descricao: 'Pico m³ por cliente · SKUs na data do pico',
    cor: '#7c3aed',
    grupo: 'financeiro',
  },
]

export const COR_BG       = T.bg
export const COR_SIDEBAR  = T.surface1
export const COR_CARD     = T.surface2
export const COR_BORDA    = T.border
export const COR_TEXTO    = T.text
export const COR_SUBTEXTO = T.textMuted
