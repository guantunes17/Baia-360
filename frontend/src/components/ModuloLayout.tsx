import React from 'react'
import { T } from '@/lib/theme'
import { glass, neoShadow, neoShadowInset } from '@/lib/glass'
import { Play, RotateCcw, Download, Loader2, CheckCircle, XCircle } from 'lucide-react'

type Status = 'idle' | 'processando' | 'concluido' | 'erro'

interface ModuloLayoutProps {
  titulo: string
  subtitulo: string
  cor: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  status: Status
  logs: string[]
  erro: string
  podeProcessar: boolean
  onProcessar: () => void
  onResetar: () => void
  onBaixar?: () => void
  configTitulo?: string
  extras?: React.ReactNode
  children: React.ReactNode
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(8,11,20,0.7)',
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  fontSize: 13,
  outline: 'none',
  boxShadow: neoShadowInset,
  boxSizing: 'border-box',
}

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: T.textMuted,
  marginBottom: 6,
  fontWeight: 500,
}

export const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: T.textDim,
  marginTop: 4,
}

export function ModuloLayout({
  titulo,
  subtitulo,
  cor,
  icon: Icon,
  status,
  logs,
  erro,
  podeProcessar,
  onProcessar,
  onResetar,
  onBaixar,
  configTitulo = 'Configuração',
  extras,
  children,
}: ModuloLayoutProps) {
  return (
    <div style={{ padding: 32, maxWidth: 720 }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          width: 40, height: 2, borderRadius: 1, marginBottom: 14,
          background: `linear-gradient(90deg, ${cor}, transparent)`,
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `${cor}14`,
            border: `1px solid ${cor}28`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 0 14px ${cor}14`,
          }}>
            <Icon size={20} color={cor} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0 }}>{titulo}</h1>
        </div>
        <p style={{ fontSize: 11, color: T.textMuted, margin: 0, letterSpacing: '0.03em' }}>{subtitulo}</p>
      </div>

      {/* Extra sections (DB management, etc.) */}
      {extras}

      {/* Config card */}
      <div style={{
        ...glass(0.35, 20),
        boxShadow: neoShadow,
        borderRadius: 14,
        borderColor: `${cor}20`,
        marginBottom: 20,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: cor }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{configTitulo}</span>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={onProcessar}
          disabled={!podeProcessar || status === 'processando'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 18px', borderRadius: 8, cursor: (!podeProcessar || status === 'processando') ? 'not-allowed' : 'pointer',
            background: (!podeProcessar || status === 'processando')
              ? 'rgba(255,255,255,0.05)'
              : `linear-gradient(135deg, ${cor}, ${cor}bb)`,
            border: `1px solid ${(!podeProcessar || status === 'processando') ? T.border : cor + '66'}`,
            color: (!podeProcessar || status === 'processando') ? T.textDim : '#fff',
            fontSize: 13, fontWeight: 600,
            transition: 'all 0.2s',
            opacity: (!podeProcessar || status === 'processando') ? 0.6 : 1,
          }}
        >
          {status === 'processando'
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Processando...</>
            : <><Play size={13} /> Gerar Relatório</>
          }
        </button>

        {status !== 'idle' && (
          <button
            onClick={onResetar}
            style={{
              ...glass(0.2, 10),
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              fontSize: 13, color: T.textMuted, transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = T.borderHover}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = T.border}
          >
            <RotateCcw size={13} /> Limpar
          </button>
        )}

        {status === 'concluido' && onBaixar && (
          <button
            onClick={onBaixar}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
              background: `linear-gradient(135deg, ${T.accentGreen}, ${T.accentGreen}bb)`,
              border: `1px solid ${T.accentGreen}55`,
              color: '#fff', fontSize: 13, fontWeight: 600,
              transition: 'all 0.2s',
            }}
          >
            <Download size={13} /> Baixar Relatório
          </button>
        )}
      </div>

      {/* Log */}
      {logs.length > 0 && (
        <div style={{
          ...glass(0.25, 16),
          boxShadow: neoShadow,
          borderRadius: 12,
          marginBottom: 16,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Log de Processamento
            </span>
          </div>
          <div style={{ padding: '12px 16px', maxHeight: 240, overflowY: 'auto' }}>
            {logs.map((linha, i) => (
              <p key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: T.accentBlue, margin: '1px 0' }}>
                {linha}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div style={{
          ...glass(0.3, 16),
          borderColor: `${T.accentRed}50`,
          boxShadow: `${neoShadow}, 0 0 20px ${T.accentRed}10`,
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 12,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <XCircle size={16} color={T.accentRed} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: T.accentRed }}>{erro}</span>
        </div>
      )}

      {/* Sucesso */}
      {status === 'concluido' && (
        <div style={{
          ...glass(0.3, 16),
          borderColor: `${T.accentGreen}40`,
          boxShadow: `${neoShadow}, 0 0 20px ${T.accentGreen}08`,
          borderRadius: 12,
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <CheckCircle size={16} color={T.accentGreen} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: T.accentGreen }}>
            Relatório gerado com sucesso! Clique em "Baixar Relatório" para fazer o download.
          </span>
        </div>
      )}

    </div>
  )
}
