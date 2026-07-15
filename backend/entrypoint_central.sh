#!/bin/sh
set -e
echo "Iniciando banco de dados..."
# migrations/env.py importa este módulo (não app.py) para pegar db.metadata —
# sem isso, a migração de Central puxaria app.py (Atlas) e quebraria no
# requer_emissao=True do Atlas, que Central nunca configura (nem deveria).
export ALEMBIC_APP_MODULE=central_app
alembic upgrade head || { echo "ALEMBIC UPGRADE FALHOU"; exit 1; }
echo "Banco inicializado com sucesso."
echo "Iniciando gunicorn (central)..."
exec gunicorn central_app:app \
    --bind 0.0.0.0:5003 \
    --workers 1 \
    --timeout 300 \
    --worker-class sync
