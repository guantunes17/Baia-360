import { useEffect, useState } from 'react'

export interface ToastData {
  id: number
  tipo: 'sucesso' | 'erro' | 'aviso'
  mensagem: string
}

interface Props {
  toasts: ToastData[]
  onRemover: (id: number) => void
}

export function ToastContainer({ toasts, onRemover }: Props) {
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
      {toasts.map(t => (
        <Toast key={t.id} toast={t} onRemover={onRemover} />
      ))}
    </div>
  )
}

function Toast({ toast, onRemover }: { toast: ToastData; onRemover: (id: number) => void }) {
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    setTimeout(() => setVisivel(true), 10)
    const timer = setTimeout(() => {
      setVisivel(false)
      setTimeout(() => onRemover(toast.id), 300)
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  const fechar = () => {
    setVisivel(false)
    setTimeout(() => onRemover(toast.id), 300)
  }

  const config = {
    sucesso: {
      cor: '#10b981',
      bg: '#10b98118',
      titulo: 'Sucesso',
      icone: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="#10b981" strokeWidth="1.5"/>
          <path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    erro: {
      cor: '#ef4444',
      bg: '#ef444418',
      titulo: 'Erro',
      icone: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5"/>
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    aviso: {
      cor: '#f0b429',
      bg: '#f0b42918',
      titulo: 'Aviso',
      icone: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2L14 13H2L8 2Z" stroke="#f0b429" strokeWidth="1.5" strokeLinejoin="round"/>
          <line x1="8" y1="7" x2="8" y2="10" stroke="#f0b429" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="8" cy="11.5" r="0.75" fill="#f0b429"/>
        </svg>
      ),
    },
  }

  const { cor, bg, titulo, icone } = config[toast.tipo]

  return (
    <div
      style={{
        background:   '#1a1d27',
        border:       `0.5px solid ${cor}44`,
        borderLeft:   `3px solid ${cor}`,
        borderRadius: '10px',
        padding:      '12px 14px',
        display:      'flex',
        alignItems:   'center',
        gap:          '10px',
        minWidth:     '300px',
        maxWidth:     '380px',
        position:     'relative',
        overflow:     'hidden',
        opacity:      visivel ? 1 : 0,
        transform:    visivel ? 'translateX(0)' : 'translateX(20px)',
        transition:   'all 0.3s ease',
      }}
    >
      {/* Ícone */}
      <div style={{ width: 32, height: 32, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icone}
      </div>

      {/* Texto */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 2 }}>{titulo}</div>
        <div style={{ fontSize: 12, color: '#8892a4' }}>{toast.mensagem}</div>
      </div>

      {/* Botão fechar */}
      <div
        onClick={fechar}
        style={{ width: 20, height: 20, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8892a4', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
      >
        ✕
      </div>

      {/* Barra de progresso */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, height: 2,
        background: cor, opacity: 0.4,
        animation: 'toastProgress 4s linear forwards'
      }} />

      <style>{`
        @keyframes toastProgress { from { width: 100%; } to { width: 0%; } }
      `}</style>
    </div>
  )
}