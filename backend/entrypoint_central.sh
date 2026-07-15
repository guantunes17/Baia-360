#!/bin/sh
set -e
echo "Iniciando banco de dados..."
alembic upgrade head || { echo "ALEMBIC UPGRADE FALHOU"; exit 1; }
echo "Banco inicializado com sucesso."
echo "Iniciando gunicorn (central)..."
exec gunicorn central_app:app \
    --bind 0.0.0.0:5003 \
    --workers 1 \
    --timeout 300 \
    --worker-class sync
