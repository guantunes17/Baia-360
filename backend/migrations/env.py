import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlalchemy import text

from alembic import context

# backend/ holds app.py — make sure it's importable regardless of the CWD
# alembic was invoked from (mirrors how tasks_observabilidade.py reaches app.py).
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app import db  # noqa: E402 — also loads backend/.env as a side effect

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = db.metadata

# Same env var the app reads (see app.py's SQLALCHEMY_DATABASE_URI). Importing
# `app` above already loaded backend/.env via load_dotenv, so this picks up
# dev's .env value or, in prod, the real DATABASE_URL injected into the
# container — alembic.ini itself is left blank on purpose.
database_url = os.getenv("DATABASE_URL")
if database_url:
    config.set_main_option("sqlalchemy.url", database_url)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_schemas=True,  # Fase 4: modelos agora vivem em atlas/central/identity, não só public
    )

    with context.begin_transaction():
        context.run_migrations()


# Chave arbitrária, mas CONSTANTE — coordena boots concorrentes via advisory
# lock do Postgres (vive no banco, funciona entre containers/hosts; ao
# contrário de flock, que é por filesystem local e não serve aqui).
ALEMBIC_ADVISORY_LOCK_KEY = 728041


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # pg_advisory_lock é session-scoped, não transaction-scoped — commitar
        # aqui só fecha a transação implícita que o execute() abriu (autobegin
        # do SQLAlchemy 2.0), sem soltar a trava. Necessário: se essa transação
        # ficar aberta, o MigrationContext do Alembic detecta uma "external
        # transaction" já em andamento e passa a esperar QUE ELA seja
        # commitada por fora — o commit interno do run_migrations() vira
        # no-op e tudo é revertido no rollback do close() da connection.
        connection.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ALEMBIC_ADVISORY_LOCK_KEY})
        connection.commit()
        try:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
                compare_server_default=True,
                include_schemas=True,  # Fase 4: modelos agora vivem em atlas/central/identity, não só public
            )

            with context.begin_transaction():
                context.run_migrations()
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ALEMBIC_ADVISORY_LOCK_KEY})
            connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
