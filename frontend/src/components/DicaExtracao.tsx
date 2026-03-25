interface Props {
  linhas: string[]
}

export function DicaExtracao({ linhas }: Props) {
  return (
    <div
      className="rounded-md border p-3 text-xs space-y-1"
      style={{ background: '#0f1117', borderColor: '#2d3148', color: '#8892a4' }}
    >
      {linhas.map((linha, i) => (
        <p key={i}>{linha}</p>
      ))}
    </div>
  )
}