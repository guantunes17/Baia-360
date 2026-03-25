# Baia 360

Plataforma web de relatórios operacionais e financeiros da **Baia 4 Logística e Transportes**.

## Stack
- **Backend:** Python · Flask · SQLAlchemy · JWT
- **Frontend:** React · TypeScript · Tailwind CSS · shadcn/ui
- **Banco de dados:** PostgreSQL (produção) · SQLite (desenvolvimento)
- **Deploy:** Docker · Railway/AWS

## Desenvolvimento local

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Variáveis de ambiente
Copie `backend/.env.example` para `backend/.env` e preencha os valores.