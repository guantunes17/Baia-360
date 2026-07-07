"""Schema smoke test: after db.create_all() on the isolated test DB, the tables
and key columns the other 5 (mocked) test tiers depend on actually exist."""


def test_tables_exist(app, db):
    with app.app_context():
        from sqlalchemy import inspect
        tables = set(inspect(db.engine).get_table_names())
    assert 'atlas_rag_trace' in tables
    assert 'atlas_golden_qa' in tables
    assert 'atlas_golden_run' in tables


def test_atlas_rag_trace_key_columns(app, db):
    with app.app_context():
        from sqlalchemy import inspect
        columns = {c['name'] for c in inspect(db.engine).get_columns('atlas_rag_trace')}
    expected = {
        'id', 'usuario_id', 'conv_id', 'response_id', 'modelo',
        'pergunta', 'resposta', 'retrieval_query', 'retrieval_count',
        'top_score', 'mean_score', 'zero_retrieval', 'chunks_json',
        'n_file_citations', 'citation_coverage', 'feedback',
        'groundedness', 'eval_faithfulness', 'eval_answer_rel',
        'eval_context_rel', 'eval_flagged', 'eval_modelo',
        'latencia_ms', 'tokens_in', 'tokens_out', 'criado_em',
    }
    missing = expected - columns
    assert not missing, f'missing columns on atlas_rag_trace: {missing}'
