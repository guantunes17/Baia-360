"""
extrair_rag_do_output is the gate for the whole observability pyramid: if it
mis-parses the Responses API output, every downstream trace (writer, eval,
dashboard) is silently wrong. Covered with synthetic objects that mimic the
OpenAI SDK's attribute-access model (SimpleNamespace, not dicts — the real
function reads everything via getattr(item, 'x', default)).
"""
from types import SimpleNamespace


def _result(file_id, filename, score, text):
    return SimpleNamespace(file_id=file_id, filename=filename, score=score, text=text)


def _file_search_item(queries, results):
    return SimpleNamespace(type='file_search_call', queries=queries, results=results)


def _annotation(atype, **kw):
    return SimpleNamespace(type=atype, **kw)


def _message_item(annotations, text=None):
    part = SimpleNamespace(annotations=annotations, text=text)
    return SimpleNamespace(type='message', content=[part])


def test_extracts_chunks_and_query(models):
    output = [
        _file_search_item(
            queries=['política de reembolso'],
            results=[
                _result('file_1', 'manual.pdf', 0.91, 'reembolsos em até 30 dias'),
                _result('file_2', 'faq.pdf', 0.42, 'trecho menos relevante'),
            ],
        ),
    ]
    out = models.extrair_rag_do_output(output)
    assert len(out['chunks']) == 2
    assert out['chunks'][0] == {
        'file_id': 'file_1', 'filename': 'manual.pdf', 'score': 0.91,
        'quote': 'reembolsos em até 30 dias',
    }
    assert out['retrieval_query'] == 'política de reembolso'
    assert out['n_file_citations'] == 0
    assert out['url_citations'] == []


def test_multiple_queries_joined(models):
    output = [_file_search_item(queries=['a', 'b'], results=[])]
    out = models.extrair_rag_do_output(output)
    assert out['retrieval_query'] == 'a | b'


def test_empty_results_yields_zero_chunks(models):
    """file_search ran but returned nothing — this is exactly what has to
    happen for downstream zero_retrieval to trigger in the writer."""
    output = [_file_search_item(queries=['pergunta sem cobertura'], results=[])]
    out = models.extrair_rag_do_output(output)
    assert out['chunks'] == []
    assert out['retrieval_query'] == 'pergunta sem cobertura'


def test_url_and_file_citations(models):
    output = [
        _message_item([
            _annotation('url_citation', url='https://example.com/a', title='A', start_index=0, end_index=10),
            _annotation('file_citation', file_id='file_1'),
            _annotation('file_citation', file_id='file_2'),
        ]),
    ]
    out = models.extrair_rag_do_output(output)
    assert out['n_file_citations'] == 2
    assert out['url_citations'] == [
        {'url': 'https://example.com/a', 'title': 'A', 'start': 0, 'end': 10},
    ]


def test_url_citations_deduplicated(models):
    output = [
        _message_item([
            _annotation('url_citation', url='https://example.com/a', title='A', start_index=0, end_index=5),
            _annotation('url_citation', url='https://example.com/a', title='A (again)', start_index=20, end_index=25),
        ]),
    ]
    out = models.extrair_rag_do_output(output)
    assert len(out['url_citations']) == 1


def test_mixed_file_search_and_message_items(models):
    output = [
        _file_search_item(
            queries=['q'],
            results=[_result('file_1', 'a.pdf', 0.8, 'trecho')],
        ),
        _message_item([_annotation('file_citation', file_id='file_1')]),
    ]
    out = models.extrair_rag_do_output(output)
    assert len(out['chunks']) == 1
    assert out['n_file_citations'] == 1


def test_empty_output_is_safe(models):
    out = models.extrair_rag_do_output([])
    assert out == {
        'chunks': [], 'retrieval_query': None,
        'n_file_citations': 0, 'url_citations': [], 'file_citations': [],
    }


def test_none_output_is_safe(models):
    out = models.extrair_rag_do_output(None)
    assert out['chunks'] == []


# ── Anomaly 2 regression guards ───────────────────────────────────────────────
# Live diagnostic (2026-07-08) against the real vector store showed part.annotations
# is NOT 1:1 with the inline filecite... spans in the text — one response
# had 3 spans (bundling 2+2+4 turnNfileM tokens) but only 4 annotation objects, all
# for the same file. Counting len(annotations) undercounts and can read 0 even when
# the text carries real citation markers. These three real span shapes (copied
# verbatim from that dump) plus the fallback path are the regression guard.
_SPAN_2A = 'fileciteturn0file0turn0file5'
_SPAN_2B = 'fileciteturn0file1turn0file9'
_SPAN_4  = 'fileciteturn0file1turn0file4turn0file9turn0file17'


def test_citation_spans_counted_even_with_no_annotations(models):
    texto = f'Primeiro trecho {_SPAN_2A}. Segundo trecho {_SPAN_2B}. Terceiro {_SPAN_4}.'
    output = [_message_item([], text=texto)]
    out = models.extrair_rag_do_output(output)
    assert out['n_file_citations'] == 3
    assert len(out['file_citations']) == 3


def test_span_count_wins_over_annotation_count(models):
    texto = f'Resposta com uma citação {_SPAN_2A}.'
    output = [
        _message_item(
            [_annotation('file_citation', file_id='file_1') for _ in range(4)],
            text=texto,
        ),
    ]
    out = models.extrair_rag_do_output(output)
    assert out['n_file_citations'] == 1


def test_falls_back_to_annotation_count_when_no_spans(models):
    output = [
        _message_item([
            _annotation('file_citation', file_id='file_1'),
            _annotation('file_citation', file_id='file_2'),
        ], text='Resposta sem marcador de citação no texto.'),
    ]
    out = models.extrair_rag_do_output(output)
    assert out['n_file_citations'] == 2


def test_no_citations_at_all(models):
    output = [_message_item([], text='Resposta sem nenhuma citação.')]
    out = models.extrair_rag_do_output(output)
    assert out['n_file_citations'] == 0
    # citation_coverage é derivado deste mesmo campo em _persistir_rag_trace
    # (n_file_citations > 0) — ver tests/observabilidade/test_02_writer.py.
    assert (out['n_file_citations'] > 0) is False
