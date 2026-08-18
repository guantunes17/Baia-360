"""
Política de escopo de conhecimento do Atlas + adaptador para o substrato de
retrieval (hoje: Vector Stores da OpenAI).

REGRA CENTRAL
  Nenhum outro arquivo monta {'type': 'file_search', ...}. Antes deste módulo a
  tool era construída à mão em dois pontos independentes de app.py (o chat com
  streaming e o helper de avaliação não-streaming), e um terceiro resolvia o id
  para o CRUD. Três construções paralelas da mesma coisa significam que
  qualquer política aplicada a uma e esquecida na outra vaza em silêncio, sem
  erro e sem log. O ponto de estrangulamento é o entregável, mais do que a
  escolha de mecanismo.

  Corolário: uma migração futura de substrato (pgvector, Azure AI Search) troca
  ferramenta_file_search() e nada mais da aplicação.

SEPARAÇÃO DE CAMADAS
  escopo_para()            POLÍTICA   — quem pode ver o quê. Pura: sem DB, sem
                                        env, sem I/O. Testável em memória.
  ferramenta_file_search() ADAPTADOR  — traduz o escopo para o config concreto
                                        da tool da OpenAI.
  A ponte com o banco (ler a linha viva de Permissao) vive em app.py, em
  escopo_conhecimento_do_usuario() — este módulo não importa Flask nem models,
  para que app.py e central_app.py possam importá-lo sem ciclo.

TETO DO SUBSTRATO — verificado empiricamente em 2026-08-18
  A Responses API aceita no máximo DOIS vector stores por chamada:
    2 ids -> OK
    3 ids -> 400 "Invalid input: maximum of 2 vector stores allowed."
  (scripts/probe_file_search_multistore.py reproduz.)

  Por isso BASES_VALIDAS tem exatamente dois elementos e escopo_para() não
  aceita uma lista arbitrária de bases. Uma TERCEIRA base não é uma limitação
  da aplicação que se resolve com código — é a API que recusa. Se um dia
  houver, a saída é `attributes` + `filters` numa store única, ou outro
  substrato. Registrar aqui evita que alguém tente e descubra em produção.
"""
import os
from dataclasses import dataclass

# ── Bases ─────────────────────────────────────────────────────────────────────
BASE_COMUM    = 'comum'
BASE_RESTRITA = 'restrita'
BASES_VALIDAS = (BASE_COMUM, BASE_RESTRITA)

# Chaves concedíveis em Permissao.atlas_json — mesmo papel de
# HUB_CONCEDIVEIS/MODULOS_CONCEDIVEIS em app.py: o PUT de permissões filtra
# contra esta tupla e descarta em silêncio o que não estiver aqui.
ATLAS_CONCEDIVEIS = ('base_restrita',)

# Rótulos para a UI de administração. Ficam aqui, junto das constantes que
# definem as bases, para não haver duas listas de bases em arquivos diferentes.
BASES_ROTULOS = {
    BASE_COMUM:    'Base Comum',
    BASE_RESTRITA: 'Base Restrita',
}


@dataclass(frozen=True)
class EscopoConhecimento:
    """Escopo EXPLÍCITO de conhecimento de um turno.

    Deliberadamente não é um id cru de vector store: o que a política decide é
    *quais bases* o usuário alcança; a tradução para ids é problema do
    adaptador. Frozen porque um escopo já decidido não deve ser mutado por
    nenhum call site depois de construído.

    `bases` é sempre uma tupla não-vazia começando por BASE_COMUM — garantido
    pela construção em escopo_para(), único produtor legítimo.
    """
    bases: tuple

    def rotulo(self) -> str:
        """'comum' | 'comum+restrita' — usado em log e no dashboard."""
        return '+'.join(self.bases)


def escopo_para(perfil, atlas_permissoes) -> EscopoConhecimento:
    """POLÍTICA. Devolve o escopo de conhecimento de um usuário.

    Pura de propósito: recebe dados já lidos do banco em vez de consultar. Isso
    é o que torna a regra testável sem Postgres e sem Flask.

    FAIL-CLOSED POR CONSTRUÇÃO — a razão do desenho ser este e não outro: a
    lista começa contendo apenas COMUM, e RESTRITA só é acrescentada sob
    afirmação positiva. Não existe caminho de erro, de ausência de dado ou de
    exceção que ACRESCENTE acesso. Omissão sempre resulta em menos escopo,
    nunca em mais. (É por isso que a segregação vive em duas stores e não em
    filtros por atributo: esquecer o filtro devolveria tudo.)

    `atlas_permissoes` é o dict já desserializado de Permissao.atlas_json —
    a linha VIVA do banco, nunca a string `perfil` (COUPLING_MAP §5). A única
    exceção é o bypass de admin, coerente com _verificar_permissao_modulo.

    (None, None) -> ('comum',): é o caso do helper de avaliação, que roda sem
    usuário. O escopo default tem de ser o comum, nunca o restrito — caso
    contrário o judge avaliaria sobre um escopo que nenhum usuário real possui
    e a métrica de faithfulness passaria a medir algo inexistente em produção.
    """
    bases = []
    bases.append(BASE_COMUM)

    if perfil == 'admin':
        bases.append(BASE_RESTRITA)
    elif isinstance(atlas_permissoes, dict) and atlas_permissoes.get('base_restrita') is True:
        # `is True`, não truthy: uma linha corrompida com a STRING "false" é
        # truthy em Python e concederia acesso restrito silenciosamente. Só o
        # booleano verdadeiro conta.
        bases.append(BASE_RESTRITA)

    return EscopoConhecimento(tuple(bases))


# ── Adaptador: escopo -> substrato ────────────────────────────────────────────
def store_id_da_base(base: str) -> str:
    """Id da vector store de uma base, ou '' se não configurada.

    COMUM aceita OPENAI_VECTOR_STORE_ID como fallback: é o nome que a produção
    já usa hoje: enquanto a var nova não for setada, a base comum continua
    apontando para a store única de sempre e o retrieval não muda para ninguém.
    """
    if base == BASE_COMUM:
        return (os.getenv('ATLAS_VECTOR_STORE_COMUM_ID', '').strip()
                or os.getenv('OPENAI_VECTOR_STORE_ID', '').strip())
    if base == BASE_RESTRITA:
        return os.getenv('ATLAS_VECTOR_STORE_RESTRITA_ID', '').strip()
    return ''


def bases_configuradas() -> dict:
    """{'comum': 'vs_...', 'restrita': ''} — o CRUD usa para saber o que
    enumerar e para dizer à UI qual base ainda não existe no servidor."""
    return {base: store_id_da_base(base) for base in BASES_VALIDAS}


def ferramenta_file_search(escopo: EscopoConhecimento):
    """ADAPTADOR. Traduz um escopo no config concreto da tool `file_search`.

    Devolve (tool | None, bases_efetivas: list[str]).

    `bases_efetivas` é o que de fato foi anexado, que pode ser MENOS do que a
    política concedeu: uma base cujo store não está configurado é descartada
    silenciosamente em vez de virar erro. Isso é deliberado — se
    ATLAS_VECTOR_STORE_RESTRITA_ID estiver vazia, o usuário concedido degrada
    para a base comum e continua conversando; o Atlas não cai. É também por
    isso que `bases_efetivas` é gravado no trace: a degradação fica VISÍVEL no
    dashboard em vez de sumir (o valor gravado seria ["comum"], não
    ["comum","restrita"]).

    Nenhum store configurado -> (None, []): o Atlas responde sem file_search,
    exatamente como fazia quando OPENAI_VECTOR_STORE_ID estava vazia.

    INVARIANTE: o retorno nunca é uma tool que alcança apenas a base restrita.
    Ou a base comum está presente, ou não há tool nenhuma.
    """
    # A base comum é o piso de todo escopo. Se ela não está configurada, a
    # instalação está quebrada, e a saída correta é não recuperar nada — e não
    # servir SÓ a base restrita ao subconjunto de usuários que tem a concessão
    # enquanto todos os outros ficam sem retrieval. Esse estado parcial é
    # justamente o tipo de degradação silenciosa que este módulo existe para
    # não produzir: aqui a falha é uniforme e aparece no dashboard como
    # escopo vazio para todo mundo, não como um privilégio invertido.
    id_comum = store_id_da_base(BASE_COMUM)
    if not id_comum:
        return None, []

    ids = [id_comum]
    bases_efetivas = [BASE_COMUM]
    for base in escopo.bases:
        if base == BASE_COMUM:
            continue
        vs_id = store_id_da_base(base)
        # `not in ids` protege o caso em que as duas vars apontam para a mesma
        # store por engano de configuração: a API rejeitaria ids duplicados e
        # derrubaria o chat inteiro por um erro de .env.
        if vs_id and vs_id not in ids:
            ids.append(vs_id)
            bases_efetivas.append(base)

    return {'type': 'file_search', 'vector_store_ids': ids}, bases_efetivas
