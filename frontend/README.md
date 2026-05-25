# Baia 360 — Frontend

Interface web da plataforma Baia 360, construída com React 19, TypeScript e Vite 8.

## Stack

- **React 19** + **TypeScript**
- **Vite 8** — bundler e dev server
- **Tailwind CSS 4** — estilização utilitária
- **shadcn/ui** + **Radix UI** — componentes de UI
- **React Router 7** — roteamento client-side
- **Axios** — requisições HTTP
- **Lucide React** — ícones

## Desenvolvimento

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # build de produção em dist/
npm run preview   # prévia do build
npm run lint      # ESLint
```

## Estrutura

```
src/
├── pages/              # Uma página por rota
│   ├── Home.tsx
│   ├── Hub.tsx
│   ├── Atlas.tsx       # Assistente de IA
│   ├── Pedidos.tsx
│   ├── Fretes.tsx
│   ├── Armazenagem.tsx
│   ├── Estoque.tsx
│   ├── Recebimentos.tsx
│   ├── CapOperacional.tsx
│   ├── FatDistribuicao.tsx
│   ├── FatArmazenagem.tsx
│   ├── PainelControle.tsx
│   ├── PainelResultados.tsx
│   ├── BaseConhecimento.tsx
│   ├── Agenda.tsx
│   ├── Usuarios.tsx
│   └── Perfil.tsx
├── components/
│   ├── ui/             # Componentes shadcn/ui
│   ├── AppSidebar.tsx
│   ├── ModuloLayout.tsx
│   ├── AmbientBackground.tsx
│   ├── HomeCard.tsx
│   ├── Toast.tsx
│   └── LogoBaia360.tsx
├── hooks/
│   ├── useRipple.ts
│   ├── useOutlookNotifier.ts
│   └── use-mobile.ts
├── lib/
│   ├── utils.ts
│   ├── theme.ts        # Tema Dark Glass
│   ├── glass.ts        # Estilos glassmorphism
│   ├── ripple.ts
│   └── constants.ts
├── config.ts           # URL da API (VITE_API_URL)
├── App.tsx             # Roteamento principal
└── main.tsx            # Entry point
```

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL base da API Flask (ex.: `http://localhost:5001`) |

Crie `.env.development` para desenvolvimento local.

## Geração de documentos

O frontend suporta exportação de relatórios diretamente pelo browser:

- **PDF** via `jspdf`
- **DOCX** via `docx` + `file-saver`

## Build e deploy

O `Dockerfile` usa build multi-stage:

1. **Builder** (Node 24-Alpine) — executa `npm run build`
2. **Runtime** (Nginx Alpine) — serve os arquivos estáticos de `dist/`

O `nginx.conf` configura o Nginx para servir a SPA corretamente (fallback para `index.html`).
