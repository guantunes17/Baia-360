/**
 * useOutlookNotifier — Fase 4b Baia 360
 *
 * Hook que verifica eventos próximos do Outlook UMA VEZ ao montar
 * e dispara callbacks de toast para cada evento dentro da janela de aviso.
 *
 * Não faz polling — sem processos rodando em background.
 * Se o usuário não tiver o Outlook conectado, retorna silenciosamente.
 */

import { useEffect } from 'react'
import { API } from '@/config'

interface Evento {
  titulo:      string
  inicio:      string  // ISO string UTC
  fim:         string
  local:       string
  dia_inteiro: boolean
}

interface OpcoesNotifier {
  /** Token JWT do usuário logado */
  token: string | null
  /** Callback para disparar um toast de aviso */
  onAviso: (mensagem: string) => void
  /** Quantas horas à frente verificar (default: 2) */
  horasAhead?: number
}

/**
 * Formata a diferença de tempo entre agora e o início do evento
 * em linguagem natural: "em 15 min", "em 1h 30min", etc.
 */
function formatarTempo(inicioISO: string): string {
  const agora   = new Date()
  const inicio  = new Date(inicioISO)
  const diffMs  = inicio.getTime() - agora.getTime()
  const diffMin = Math.round(diffMs / 60000)

  if (diffMin <= 0)  return 'agora'
  if (diffMin < 60)  return `em ${diffMin} min`

  const horas = Math.floor(diffMin / 60)
  const mins  = diffMin % 60
  return mins > 0 ? `em ${horas}h ${mins}min` : `em ${horas}h`
}

/**
 * Formata a hora local do evento a partir do ISO string UTC.
 * Ex: "2026-04-08T14:00:00" → "11:00" (em BRT)
 */
function formatarHora(inicioISO: string): string {
  try {
    return new Date(inicioISO).toLocaleTimeString('pt-BR', {
      hour:   '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo'
    })
  } catch {
    return ''
  }
}

export function useOutlookNotifier({
  token,
  onAviso,
  horasAhead = 2
}: OpcoesNotifier) {
  useEffect(() => {
    // Sem token = usuário não logado, não faz nada
    if (!token) return

    const verificar = async () => {
      try {
        const res = await fetch(
          `${API}/api/outlook/eventos_proximos?horas=${horasAhead}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )

        if (!res.ok) return

        const data = await res.json()

        // Outlook não conectado — silencioso, sem toast de erro
        if (!data.conectado) return

        const eventos: Evento[] = data.eventos || []
        if (eventos.length === 0) return

        // Dispara um toast por evento dentro da janela de aviso
        // Pequeno delay entre toasts para não empilhar todos ao mesmo tempo
        eventos.forEach((ev, i) => {
          setTimeout(() => {
            const hora   = ev.dia_inteiro ? 'dia inteiro' : formatarHora(ev.inicio)
            const tempo  = ev.dia_inteiro ? '' : ` · ${formatarTempo(ev.inicio)}`
            const local  = ev.local ? ` · ${ev.local}` : ''
            onAviso(`📅 ${ev.titulo} — ${hora}${tempo}${local}`)
          }, i * 800) // 800ms entre cada toast
        })

      } catch {
        // Falha silenciosa — notificações não devem quebrar a UX
      }
    }

    verificar()
    // [] garante execução única na montagem do componente
  }, [])
}