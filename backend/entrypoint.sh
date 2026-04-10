#!/bin/sh
echo "Iniciando banco de dados..."
python -c "
from app import app, db
with app.app_context():
    db.create_all()
print('Banco inicializado com sucesso.')
"
echo "Iniciando gunicorn..."
exec gunicorn app:app \
    --bind 0.0.0.0:5001 \
    --workers 4 \
    --timeout 120 \
    --worker-class sync