import { useEffect, useState } from 'react'

export interface ToastData {
  id: number
  tipo: 'sucesso' | 'erro'
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

function Toast({ toast, onRemover }: { toast: ToastData, onRemover: (id: number) => void }) {
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    // Anima entrada
    setTimeout(() => setVisivel(true), 10)
    // Auto-remove após 4s
    const timer = setTimeout(() => {
      setVisivel(false)
      setTimeout(() => onRemover(toast.id), 300)
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  const cor     = toast.tipo === 'sucesso' ? '#10b981' : '#ef4444'
  const bgCor   = toast.tipo === 'sucesso' ? '#10b98118' : '#ef444418'
  const icone   = toast.tipo === 'sucesso' ? '✅' : '❌'

  return (
    <div
      onClick={() => { setVisivel(false); setTimeout(() => onRemover(toast.id), 300) }}
      style={{
        background:    '#1a1d27',
        border:        `1px solid ${cor}`,
        borderLeft:    `4px solid ${cor}`,
        borderRadius:  '8px',
        padding:       '12px 16px',
        display:       'flex',
        alignItems:    'center',
        gap:           '10px',
        minWidth:      '280px',
        maxWidth:      '380px',
        cursor:        'pointer',
        boxShadow:     `0 4px 20px ${bgCor}`,
        opacity:       visivel ? 1 : 0,
        transform:     visivel ? 'translateX(0)' : 'translateX(20px)',
        transition:    'all 0.3s ease',
      }}
    >
      <span style={{ fontSize: '16px' }}>{icone}</span>
      <span style={{ color: '#e2e8f0', fontSize: '13px', flex: 1 }}>{toast.mensagem}</span>
    </div>
  )
}