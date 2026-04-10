"""
Script de migração única: SQLite → PostgreSQL
Execute no servidor DEPOIS de subir os containers:
  docker exec -it baia360-backend python migrate_sqlite_para_postgres.py
"""
import sqlite3
import psycopg2
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env.production')

SQLITE_PATH = Path(__file__).parent / 'baia360.db'
PG_URL      = os.getenv('DATABASE_URL')

if not SQLITE_PATH.exists():
    print("Arquivo SQLite não encontrado — nada a migrar.")
    exit(0)

print(f"Conectando ao SQLite: {SQLITE_PATH}")
sqlite = sqlite3.connect(SQLITE_PATH)
sqlite.row_factory = sqlite3.Row

print(f"Conectando ao PostgreSQL...")
pg = psycopg2.connect(PG_URL)
pg.autocommit = False
cur = pg.cursor()

try:
    # ── Usuários ──────────────────────────────────────────────────
    rows = sqlite.execute("SELECT * FROM users").fetchall()
    print(f"  Migrando {len(rows)} usuários...")
    for r in rows:
        cur.execute("""
            INSERT INTO baia360_users (id, nome, email, senha_hash, perfil, ativo, criado_em)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
        """, (r['id'], r['nome'], r['email'], r['senha_hash'],
              r['perfil'], bool(r['ativo']), r['criado_em']))

    # ── Relatórios gerados ────────────────────────────────────────
    rows = sqlite.execute("SELECT * FROM relatorios_gerados").fetchall()
    print(f"  Migrando {len(rows)} relatórios...")
    for r in rows:
        cur.execute("""
            INSERT INTO relatorios_gerados (id, modulo, mes_ref, usuario_id, gerado_em, kpis_json)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
        """, (r['id'], r['modulo'], r['mes_ref'],
              r['usuario_id'], r['gerado_em'],
              r['kpis_json'] if 'kpis_json' in r.keys() else None))

    # ── Conversas Atlas ───────────────────────────────────────────
    try:
        rows = sqlite.execute("SELECT * FROM atlas_conversas").fetchall()
        print(f"  Migrando {len(rows)} conversas do Atlas...")
        for r in rows:
            cur.execute("""
                INSERT INTO atlas_conversas
                    (id, usuario_id, conv_id, titulo, msgs_json, history_json, criada_em, atualizada_em)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, (r['id'], r['usuario_id'], r['conv_id'], r['titulo'],
                  r['msgs_json'], r['history_json'],
                  r['criada_em'], r['atualizada_em']))
    except sqlite3.OperationalError:
        print("  Tabela atlas_conversas não encontrada, pulando.")

    pg.commit()
    print("\nMigração concluída com sucesso!")

except Exception as e:
    pg.rollback()
    print(f"\nErro durante a migração: {e}")
    raise

finally:
    sqlite.close()
    pg.close()