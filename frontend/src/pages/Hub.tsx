import React from 'react'
import { T } from '@/lib/theme'
import { glass, neoShadow } from '@/lib/glass'
import { addRipple } from '@/lib/ripple'
import { AmbientBackground } from '@/components/AmbientBackground'
import { LogoBaia360 } from '@/components/LogoBaia360'
import {
  FileSpreadsheet, Bot, Activity, TrendingUp,
  Calendar, Users, Brain, ChevronRight, LogOut,
} from 'lucide-react'

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
  onLogout,
}: Props) {
  const hoje = new Date()
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const dataFormatada = `${diasSemana[hoje.getDay()]}, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`

  const perfil = usuario.perfil
  const isAdmin = perfil === 'admin'
  const temHub = (key: string) => isAdmin || (permissoes != null && permissoes.hub.includes(key))
  const temRelatorios = temHub('central')
  const primeiroNome = usuario.nome.split(' ')[0]

  const badgePerfil: Record<string, { label: string; color: string }> = {
    admin:       { label: 'Admin',       color: T.accentBlue },
    analista:    { label: 'Analista',    color: T.accentPurple },
    financeiro:  { label: 'Financeiro',  color: T.accentAmber },
    operacional: { label: 'Operacional', color: T.accentGreen },
  }
  const bp = badgePerfil[perfil]

  const nCardsPrincipais = [temRelatorios, true, temHub('painel_controle'), temHub('painel_resultados')].filter(Boolean).length
  const gridCols = nCardsPrincipais === 1 ? '1fr' : nCardsPrincipais === 2 ? 'repeat(2,1fr)' : 'repeat(3,1fr)'

  const cardPrincipal = (
    Icon: React.ComponentType<{ size?: number; color?: string }>,
    titulo: string,
    descricao: string,
    cor: string,
    onClick: () => void,
  ) => (
    <div
      onClick={e => { addRipple(e); onClick() }}
      style={{
        ...glass(0.35, 20),
        boxShadow: neoShadow,
        borderRadius: 16,
        borderColor: `${cor}30`,
        padding: '28px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}66`
        el.style.boxShadow = `${neoShadow}, 0 0 28px ${cor}18`
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}30`
        el.style.boxShadow = neoShadow
        el.style.transform = 'translateY(0)'
      }}
    >
      <div style={{
        width: 54, height: 54, borderRadius: 14,
        background: `${cor}14`,
        border: `1px solid ${cor}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 18px ${cor}18`,
      }}>
        <Icon size={24} color={cor} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: T.text, margin: '0 0 4px' }}>{titulo}</p>
        <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>{descricao}</p>
      </div>
    </div>
  )

  const cardSecundario = (
    Icon: React.ComponentType<{ size?: number; color?: string }>,
    titulo: string,
    descricao: string,
    cor: string,
    onClick: () => void,
  ) => (
    <div
      onClick={e => { addRipple(e); onClick() }}
      style={{
        ...glass(0.30, 16),
        boxShadow: neoShadow,
        borderRadius: 12,
        borderColor: `${cor}20`,
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}50`
        el.style.boxShadow = `${neoShadow}, 0 0 16px ${cor}14`
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = `${cor}20`
        el.style.boxShadow = neoShadow
        el.style.transform = 'translateY(0)'
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${cor}12`,
        border: `1px solid ${cor}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={18} color={cor} />
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: T.text, margin: '0 0 2px' }}>{titulo}</p>
        <p style={{ fontSize: 10, color: T.textMuted, margin: 0 }}>{descricao}</p>
      </div>
      <ChevronRight size={16} color={T.textDim} />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: T.bg, position: 'relative' }}>
      <AmbientBackground />

      {/* Topbar */}
      <header
        style={{
          ...glass(0.4, 16),
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 32px',
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: 'none',
          boxShadow: '0 2px 24px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoBaia360 size={32} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: T.text, margin: 0 }}>Baia 360</p>
            <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>Baia 4 Logística e Transportes</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {bp && (
            <span style={{
              fontSize: 10,
              background: `${bp.color}18`,
              color: bp.color,
              border: `0.5px solid ${bp.color}30`,
              padding: '3px 10px',
              borderRadius: 6,
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}>
              {bp.label}
            </span>
          )}

          <button
            onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); onEntrarPerfil() }}
            title="Meu perfil"
            style={{
              ...glass(0.2, 10),
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = T.borderHover}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = T.border}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: `linear-gradient(135deg, ${T.navy}, ${T.accentBlue}44)`,
              border: `1px solid ${T.gold}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.gold }}>
                {primeiroNome.charAt(0).toUpperCase()}
              </span>
            </div>
            <span style={{ fontSize: 13, color: T.textMuted }}>{usuario.nome}</span>
          </button>

          <button
            onClick={e => { addRipple(e as React.MouseEvent<HTMLElement>); onLogout() }}
            title="Sair"
            style={{
              ...glass(0.2, 10),
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'all 0.15s',
              color: T.textMuted,
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.borderColor = T.accentRed + '55'
              el.style.color = T.accentRed
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.borderColor = T.border
              el.style.color = T.textMuted
            }}
          >
            <LogOut size={14} />
            <span style={{ fontSize: 13 }}>Sair</span>
          </button>
        </div>
      </header>

      {/* Conteúdo */}
      <main style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '56px 32px',
        gap: 40,
      }}>

        {/* Saudação */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64, height: 3, borderRadius: 2, margin: '0 auto 24px',
            background: `linear-gradient(90deg, transparent, ${T.gold}, transparent)`,
          }} />
          <h1 style={{ fontSize: 36, fontWeight: 700, color: T.text, margin: '0 0 8px' }}>
            Olá, {primeiroNome}!
          </h1>
          <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>{dataFormatada}</p>
        </div>

        {/* Cards principais */}
        <div style={{ width: '100%', maxWidth: 820, display: 'grid', gridTemplateColumns: gridCols, gap: 16 }}>
          {temRelatorios && cardPrincipal(FileSpreadsheet, 'Central de Relatórios', 'Geração e análise de relatórios.', T.accentBlue, onEntrarRelatorios)}
          {cardPrincipal(Bot, 'Atlas', 'Assistente IA — análises via linguagem natural.', T.accentPurple, onEntrarAtlas)}
          {temHub('painel_controle') && cardPrincipal(Activity, 'Painel de Controle', 'Métricas gerenciais e uso do sistema.', T.accentBlue, onEntrarPainelControle)}
          {temHub('painel_resultados') && cardPrincipal(TrendingUp, 'Painel de Resultados', 'KPIs operacionais por módulo e mês.', T.accentGreen, onEntrarPainelResultados)}
        </div>

        {/* Cards secundários */}
        <div style={{ width: '100%', maxWidth: 820, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
          {temHub('agenda') && cardSecundario(Calendar, 'Agenda', 'Minha agenda pessoal', T.accentGreen, onEntrarAgenda)}
        </div>

        {/* Seção admin */}
        {isAdmin && (
          <div style={{ width: '100%', maxWidth: 820 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1, height: '0.5px', background: `linear-gradient(90deg, transparent, ${T.gold}44)` }} />
              <span style={{ fontSize: 10, color: T.gold, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Administração</span>
              <div style={{ flex: 1, height: '0.5px', background: `linear-gradient(90deg, ${T.gold}44, transparent)` }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
              <div style={{ position: 'relative' }}>
                {cardSecundario(Users, 'Usuários', 'Gerenciar acessos e perfis', T.accentBlue, onEntrarUsuarios)}
                {pendentes > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    background: T.accentRed, color: '#fff',
                    fontSize: 10, fontWeight: 700,
                    borderRadius: '50%', minWidth: 18, height: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px', border: `2px solid ${T.bg}`,
                    zIndex: 1,
                  }}>
                    {pendentes}
                  </span>
                )}
              </div>
              {cardSecundario(Brain, 'Base de Conhecimento', 'Documentos indexados do Atlas', T.accentPurple, onEntrarBaseConhecimento)}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
