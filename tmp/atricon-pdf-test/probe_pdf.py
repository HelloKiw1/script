import json
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tmp/atricon-runtime'))
sys.path.insert(0, str(ROOT / 'atricon'))
for cache in [Path.home() / '.cache/ms-playwright', Path.home() / 'AppData/Local/ms-playwright']:
    if (cache / 'chromium-1194').exists():
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(cache)
        break
import coletor_atricon as c
accounts = c.load_accounts(ROOT / 'atricon/entrada/orgaos_avalia.json')
account = next(a for a in accounts if not a.get('_erro_validacao') and a['cidade'] == 'Aparecida do Rio Negro' and 'camara' in c.normalize_text(c.first_value(a, c.ORGAO_KEYS)))
output = ROOT / 'atricon/entrada/.resultado/particular/teste_pdf_cm_aparecida_2026.json'
print(json.dumps({'teste':'coletor_atricon.process_account', 'orgao': c.first_value(account,c.ORGAO_KEYS), 'cidade':account['cidade']},ensure_ascii=True),flush=True)
c.require_playwright()
with c.sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(locale='pt-BR')
    page = context.new_page()
    try:
        result = c.process_account(page, account, output, True)
        result.pop('user',None)
        result['modo_coleta']='analise_completa'
        c.write_results(output,[result])
        print(json.dumps({key:result.get(key) for key in ['questionario_id','porcentagem','status','fonte_coleta','etapa_resultado','pdf_arquivo','pdf_paginas','coleta_detalhada','cobertura_pdf','erro_evidencias','limitacoes_pdf']},ensure_ascii=True),flush=True)
        assert result['fonte_coleta']=='pdf'
        assert result['coleta_detalhada']=='concluida',result.get('erro_evidencias')
        assert result['cobertura_pdf']['itens']==result['cobertura_pdf']['itens_esperados']
        assert result['etapa_resultado']=='revisao'
        print('TESTE REAL CONCLUIDO: PDF conferido e resultado salvo em '+str(output),flush=True)
    finally:
        c.logout(page)
        context.close()
        browser.close()
