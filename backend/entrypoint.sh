#!/bin/sh
echo "Iniciando banco de dados..."
python -c "
from app import app, db, migrar_colunas_novas
with app.app_context():
    db.create_all()
    migrar_colunas_novas()
print('Banco inicializado com sucesso.')
"
echo "Iniciando gunicorn..."
exec gunicorn app:app \
    --bind 0.0.0.0:5001 \
    --workers 1 \
    --timeout 300 \
    --worker-class sync