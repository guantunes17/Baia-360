import { T } from '../lib/theme'

type Variant = 'default' | 'login' | 'atlas'

interface AmbientBackgroundProps {
  variant?: Variant
}

export function AmbientBackground({ variant = 'default' }: AmbientBackgroundProps) {
  const isLogin = variant === 'login'
  const showGrid = variant !== 'atlas'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background: T.bg,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {/* Navy orb — upper right */}
      <div
        style={{
          position: 'absolute',
          top: isLogin ? '50%' : '-10%',
          right: isLogin ? '50%' : '-5%',
          transform: isLogin ? 'translate(50%, -60%)' : undefined,
          width: isLogin ? '60vw' : '55vw',
          height: isLogin ? '60vw' : '55vw',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(0,31,91,0.53) 0%, transparent 70%)`,
          filter: 'blur(80px)',
        }}
      />
      {/* Gold orb — lower left */}
      <div
        style={{
          position: 'absolute',
          bottom: isLogin ? '50%' : '-10%',
          left: isLogin ? '50%' : '-5%',
          transform: isLogin ? 'translate(-50%, 60%)' : undefined,
          width: '40vw',
          height: '40vw',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(240,180,41,0.08) 0%, transparent 70%)`,
          filter: 'blur(80px)',
        }}
      />
      {/* Blue accent orb — center */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '50vw',
          height: '50vw',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(46,107,242,0.05) 0%, transparent 70%)`,
          filter: 'blur(100px)',
        }}
      />
      {/* SVG noise texture */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.03 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <filter id="ambient-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#ambient-noise)" />
      </svg>
      {/* Grid lines */}
      {showGrid && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.02,
            backgroundImage: `linear-gradient(${T.gold} 1px, transparent 1px), linear-gradient(90deg, ${T.gold} 1px, transparent 1px)`,
            backgroundSize: '80px 80px',
          }}
        />
      )}
    </div>
  )
}
