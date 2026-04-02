export function LogoBaia360({ size = 40 }: { size?: number }) {
  const cx = size / 2
  const cy = size / 2
  const r1 = size * 0.46  // anel externo tracejado
  const r2 = size * 0.33  // anel médio
  const r3 = size * 0.19  // núcleo
  const rPonto = size * 0.075
  const rPontoLat = size * 0.048
  const color = '#f0b429'
  const fs = size * 0.14

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Anel externo tracejado */}
      <circle
        cx={cx} cy={cy} r={r1}
        fill="none" stroke={color} strokeWidth={size * 0.022}
        strokeDasharray={`${size * 0.09} ${size * 0.065}`}
        opacity={0.3}
      />
      {/* Anel médio sólido */}
      <circle
        cx={cx} cy={cy} r={r2}
        fill="none" stroke={color} strokeWidth={size * 0.033}
        opacity={0.6}
      />
      {/* Núcleo */}
      <circle
        cx={cx} cy={cy} r={r3}
        fill={`${color}14`} stroke={color} strokeWidth={size * 0.04}
      />
      {/* 360 */}
      <text
        x={cx} y={cy + fs * 0.39}
        textAnchor="middle"
        style={{
          fill: color,
          fontSize: `${fs}px`,
          fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          letterSpacing: '0.08em'
        }}
      >
        360
      </text>
      {/* Ponto orbital topo */}
      <circle cx={cx} cy={cy - r2 - rPonto * 0.2} r={rPonto} fill={color} />
      {/* Ponto orbital lateral */}
      <circle cx={cx + r2 + rPontoLat * 0.2} cy={cy} r={rPontoLat} fill={color} opacity={0.55} />
    </svg>
  )
}