# -*- coding: utf-8 -*-
"""
Internal read-only client Atlas uses to reach Central de Relatórios data.

Phase 2 of the Atlas/Central decoupling (see
plan_atlas_central_decoupling_2026-07-13.md and
docs/architecture/COUPLING_MAP.md). Same Flask process today — this module
is the seam Phase 5 will cut along: its call sites in app.py (the
/internal/relatorios/* routes and the Atlas tool-resolution loop) won't
change, only register()'s implementation will start making a real network
call to a separate Central service instead of a local function call.

`app.py` owns the SQLAlchemy models and the DB session (it's still one
monolith), so the actual query/permission/serialization logic lives there
as `_dashboard_service`. This module deliberately avoids `from app import
...` (even deferred to call time): app.py can run either as the `__main__`
module (`python app.py`, the documented local dev entrypoint) or as the
`app` module (`gunicorn app:app` in production) — importing it back by name
from here would, in the `__main__` case, re-execute app.py as a *second*,
differently-named module, creating a second Flask app / SQLAlchemy(db)
instance that was never registered via init_app. Instead, app.py calls
register() once at import time to hand this module a direct reference to
its own `_dashboard_service`, regardless of which name it was loaded under.
"""

_dashboard_service_impl = None


class ModuloInvalidoError(ValueError):
    """Raised when an unknown module slug is requested."""


class PermissaoNegadaError(Exception):
    """Raised when the current user lacks permission for the requested module."""


def register(dashboard_service_fn) -> None:
    """Called once by app.py at import time to wire up the real implementation."""
    global _dashboard_service_impl
    _dashboard_service_impl = dashboard_service_fn


def obter_dashboard(usuario_id: int, modulo: str | None = None) -> dict:
    """Latest KPIs per module plus recent history, filtered to the modules
    `usuario_id` is allowed to see.

    modulo=None returns every module the user has permission for.
    modulo='<slug>' returns just that module, or raises:
      - ModuloInvalidoError if the slug isn't one of the known report modules
      - PermissaoNegadaError if the user isn't allowed to see that module
    """
    if _dashboard_service_impl is None:
        raise RuntimeError('central_client não inicializado — app.py deve chamar central_client.register(...) no boot.')
    return _dashboard_service_impl(usuario_id, modulo)
