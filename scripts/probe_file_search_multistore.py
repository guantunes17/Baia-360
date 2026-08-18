"""
Prova empírica: quantos vector stores o `file_search` da Responses API aceita?

POR QUE ESTE SCRIPT EXISTE
  A segregação da base de conhecimento do Atlas (COMUM / RESTRITA) depende de
  passar DOIS ids em `vector_store_ids`. Há relato público (mar/2025, fórum de
  devs da OpenAI) de que o array aceitava apenas UM elemento. O SDK não ajuda a
  decidir: `file_search_tool_param.py` declara `vector_store_ids: Required[
  SequenceNotStr[str]]`, sem `maxItems` — a validação, se existe, é server-side.

  Desenho aditivo (operacional=[COMUM], concedido=[COMUM, RESTRITA]) só é
  possível se 2+ funciona. Se não funcionar, o desenho muda para uma store
  única com `attributes` por arquivo + `filters` na consulta. Esta é a
  verificação bloqueante — nenhum código de produção antes dela.

O QUE FAZ
  1. Cria uma vector store DESCARTÁVEL com um .txt minúsculo e espera indexar.
  2. Chama responses.create com [descartável] (1 id — controle), depois
     [descartável, produção] (2 ids), depois com 3 ids repetindo o de produção.
  3. Imprime MULTI_STORE_N=OK|REJECTED:<msg> para cada caso.
  4. `finally:` apaga a store descartável e o arquivo, sempre.

  A store de PRODUÇÃO é usada apenas como segundo id numa chamada de leitura.
  Nada é escrito, anexado ou removido dela.

RESULTADO (2026-08-18, modelo gpt-5.4-mini)
  MULTI_STORE_1=OK        file_search_call presente
  MULTI_STORE_2=OK        file_search_call presente  <- desbloqueia o desenho aditivo
  MULTI_STORE_3=REJECTED  400 invalid_request_error
                          "Invalid input: maximum of 2 vector stores allowed."
                          param=tools, code=integer_above_max_value

  Ou seja: o relato de "apenas 1" está desatualizado, mas o teto é EXATAMENTE 2.
  Consequência de desenho, registrada porque não é óbvia: uma TERCEIRA base é
  estruturalmente impossível neste substrato. Não é uma limitação da aplicação
  que se resolve com código — é a API que recusa. Se um dia houver uma terceira
  base, a saída é `attributes` + `filters` numa store única, ou troca de
  substrato (pgvector). Por isso `EscopoConhecimento.bases` é validado contra
  BASES_VALIDAS em atlas_kb.py em vez de aceitar qualquer lista.

  Reverificar após mudança de modelo ou de versão da API:
    backend/venv/bin/python scripts/probe_file_search_multistore.py

CUSTO
  Três chamadas não-streaming, prompt de uma palavra, `store=False`,
  sem reasoning. Centavos.

USO
  cd /Users/gustavoantunes/Projects/Baia-360
  backend/venv/bin/python scripts/probe_file_search_multistore.py

ENV (lidos de backend/.env)
  OPENAI_API_KEY           obrigatório
  OPENAI_VECTOR_STORE_ID   obrigatório — a store de produção, só leitura
"""
import io
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# Mesmo modelo do Atlas: se houver diferença de validação por modelo, é o
# comportamento DELE que importa, não o de um modelo qualquer.
MODELO = 'gpt-5.4-mini'

_env = Path(__file__).resolve().parent.parent / 'backend' / '.env'
load_dotenv(dotenv_path=_env)

api_key = os.getenv('OPENAI_API_KEY', '').strip()
vs_prod = os.getenv('OPENAI_VECTOR_STORE_ID', '').strip()

if not api_key:
    sys.exit('OPENAI_API_KEY ausente em backend/.env')
if not vs_prod:
    sys.exit('OPENAI_VECTOR_STORE_ID ausente em backend/.env')

client = OpenAI(api_key=api_key)


def tentar(ids):
    """Devolve (ok: bool, detalhe: str) para uma chamada com `ids` stores."""
    try:
        resp = client.responses.create(
            model=MODELO,
            input=[{'role': 'user', 'content': [{'type': 'input_text',
                                                 'text': 'Cite o teor do documento indexado.'}]}],
            tools=[{'type': 'file_search', 'vector_store_ids': ids}],
            stream=False,
            store=False,
            include=['file_search_call.results'],
        )
        # Não basta não levantar: confirmar que o file_search realmente rodou.
        tipos = [getattr(i, 'type', '') for i in (resp.output or [])]
        rodou = 'file_search_call' in tipos
        return True, f'file_search_call presente={rodou} output_types={tipos}'
    except Exception as e:
        return False, f'{type(e).__name__}: {e}'


vs_temp = None
file_id = None
try:
    print(f'store de produção (só leitura): {vs_prod}')
    vs_temp = client.vector_stores.create(name='probe-multistore-DELETE-ME')
    print(f'store descartável criada:       {vs_temp.id}')

    conteudo = b'MARCADOR-PROBE-MULTISTORE-7f3a. Documento de teste descartavel.'
    arq = io.BytesIO(conteudo)
    arq.name = 'probe_multistore.txt'
    enviado = client.files.create(file=arq, purpose='assistants')
    file_id = enviado.id
    client.vector_stores.files.create_and_poll(vector_store_id=vs_temp.id, file_id=file_id)
    print('arquivo indexado.\n')

    casos = [
        ('MULTI_STORE_1', [vs_temp.id]),                    # controle
        ('MULTI_STORE_2', [vs_temp.id, vs_prod]),           # o que decide o desenho
        ('MULTI_STORE_3', [vs_temp.id, vs_prod, vs_prod]),  # teto (ids repetidos de propósito)
    ]
    for rotulo, ids in casos:
        ok, detalhe = tentar(ids)
        print(f'{rotulo}={"OK" if ok else "REJECTED"}  ({len(ids)} ids)  {detalhe}\n')
        time.sleep(1)

finally:
    if vs_temp is not None:
        try:
            client.vector_stores.delete(vector_store_id=vs_temp.id)
            print(f'store descartável {vs_temp.id} removida.')
        except Exception as e:
            print(f'ATENÇÃO: falha ao remover a store {vs_temp.id}: {e}')
    if file_id is not None:
        try:
            client.files.delete(file_id)
            print(f'arquivo {file_id} removido.')
        except Exception as e:
            print(f'ATENÇÃO: falha ao remover o arquivo {file_id}: {e}')
