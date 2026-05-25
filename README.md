# Baia 360

Plataforma web de relatórios operacionais e financeiros da **Baia 4 Logística e Transportes**.

## Stack

| Camada | Tecnologias |
|---|---|
| **Backend** | Python 3.13 · Flask 3.1 · SQLAlchemy 2.0 · JWT (httpOnly cookies) |
| **Frontend** | React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · shadcn/ui |
| **Banco de dados** | PostgreSQL 16 (produção) · SQLite (desenvolvimento) |
| **IA** | OpenAI API · Atlas (assistente interno) |
| **Integrações** | Microsoft MSAL · Outlook · Teams |
| **Deploy** | Docker · Gunicorn · Nginx · Railway/AWS |

## Módulos

- **Atlas** — Assistente de IA com acesso a dados operacionais, e-mail e calendário
- **Pedidos** — Gestão de pedidos
- **Fretes** — Controle de fretes e transportes
- **Armazenagem** — Operações de armazém
- **Estoque** — Controle de inventário
- **Recebimentos** — Recebimento de mercadorias
- **Cap. Operacional** — Capacidade operacional
- **Fat. Distribuição** — Faturamento de distribuição
- **Fat. Armazenagem** — Faturamento de armazenagem
- **Painel de Controle** — Visão gerencial consolidada
- **Painel de Resultados** — KPIs e resultados
- **Base de Conhecimento** — Documentação interna
- **Agenda** — Calendário e compromissos
- **Usuários** — Gestão de usuários e permissões

## Estrutura do projeto

```
baia-360/
├── backend/
│   ├── app.py                        # Aplicação Flask principal
│   ├── mcp_outlook_server.py         # Servidor MCP para integração Outlook
│   ├── migrate_sqlite_para_postgres.py
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── Dockerfile.mcp
│   ├── entrypoint.sh
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── pages/                    # Páginas da aplicação
│   │   ├── components/               # Componentes reutilizáveis
│   │   ├── hooks/                    # Custom hooks
│   │   ├── lib/                      # Utilitários e tema
│   │   ├── App.tsx                   # Roteamento principal
│   │   └── config.ts                 # Configuração de API
│   ├── Dockerfile
│   ├── nginx.conf
│   └── vite.config.js
├── docker-compose.yml                # Ambiente de desenvolvimento
└── docker-compose.prod.yml           # Ambiente de produção
```

## Desenvolvimento local

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/macOS
pip install -r requirements.txt
python app.py
# API disponível em http://localhost:5001
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# App disponível em http://localhost:5173
```

## Variáveis de ambiente

Copie `backend/.env.example` para `backend/.env` e preencha os valores:

```env
FLASK_ENV=development
FLASK_DEBUG=1
SECRET_KEY=sua-chave-secreta
JWT_SECRET_KEY=sua-chave-jwt
DATABASE_URL=sqlite:///baia360.db   # dev: SQLite | prod: postgresql://...
SEED_KEY=chave-para-seed
ADMIN_EMAIL=admin@exemplo.com
ADMIN_SENHA=senha-admin
```

No frontend, crie `frontend/.env.development`:

```env
VITE_API_URL=http://localhost:5001
```

## Docker

### Desenvolvimento

```bash
docker compose up --build
```

### Produção

```bash
docker compose -f docker-compose.prod.yml up -d
```

A configuração de produção inclui PostgreSQL 16, Nginx com suporte a HTTPS e o servidor MCP do Outlook.

## Deploy

O projeto está configurado para deploy em Railway ou AWS com:

- Build multi-stage no frontend (Node → Nginx)
- Gunicorn com 1 worker e timeout de 300s no backend
- Health checks nos serviços Docker
- Volumes persistentes para o banco de dados e certificados SSL
