from pathlib import Path
from collections import Counter
from decimal import Decimal
from html import escape
import csv
import json
import unicodedata

from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('C:/Users/eduar/Desktop/p7-lista-2026.csv')
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
BASE = OUT / 'relatorio_clientes_2026'
PDF = BASE.with_suffix('.pdf')
TXT = BASE.with_suffix('.txt')
norm = lambda s: ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if not unicodedata.combining(c))
rows = list(csv.DictReader(SOURCE.open(encoding='utf-8-sig', newline=''), delimiter=';'))
clients = json.loads((ROOT / 'Banner/nota_avalia.json').read_text(encoding='utf-8-sig'))
assert len(clients) == 55
results = []
for client in clients:
    typ = 'CM' if norm(client['orgão']).startswith('camara') else 'PM'
    uf = 'AM' if client['cidade'] in ['Envira', 'São Gabriel da Cachoeira'] else 'TO'
    power = 'Legislativo' if typ == 'CM' else 'Executivo'
    matches = [r for r in rows if norm(r['municipio']) == norm(client['cidade']) and r['uf'] == uf and r['poder'] == power and r['esfera'] == 'Municipal']
    assert len(matches) == 1, client
    row = matches[0]
    score = Decimal(row['indice_2026'])
    level = row['nivel_2026']
    essentials = Decimal(row['essenciais_2026'])
    assert 0 <= score <= 100
    results.append(dict(tipo=typ, cidade=client['cidade'], uf=uf, nota=score, nivel=level, essenciais=essentials, codigo=row['codigo']))

assert len({r['codigo'] for r in results}) == 55
certified = [r for r in results if r['nivel'] in ['Diamante', 'Ouro', 'Prata']]
without = [r for r in results if r['nivel'] not in ['Diamante', 'Ouro', 'Prata']]
assert not [r for r in rows if 'psicolog' in norm(r['entidade']) or 'crp' in norm(r['entidade'])]
counts = Counter(r['nivel'] for r in results)
assert counts == Counter({'Diamante': 13, 'Ouro': 4, 'Prata': 5, 'Elevado': 24, 'Intermediário': 7, 'Básico': 2})
assert len(certified) + len(without) == len(results) == 55
eligible = [r for r in results if r['nota'] >= 75]
high_without = [r for r in without if r['nota'] >= 75]
assert len(eligible) == 46 and len(high_without) == 24
assert all(r['essenciais'] < 100 for r in high_without)
num = lambda v: f'{v:.1f}'.replace('.', ',')
order = {'Diamante': 0, 'Ouro': 1, 'Prata': 2}
certified.sort(key=lambda r: (order[r['nivel']], r['tipo'], norm(r['cidade'])))
without.sort(key=lambda r: (r['tipo'], norm(r['cidade'])))

summary = [('Diamante', 13), ('Ouro', 4), ('Prata', 5), ('Sem selo registrado', 33)]
text = [
    'RELATÓRIO DOS ÓRGÃOS CLIENTES - RESULTADO DE 2026',
    'Emitido em 10/11/2026', '',
    '1. RESUMO',
    'Base de clientes: 56 órgãos da relação informada (32 Câmaras, 23 Prefeituras e CRP23).',
    'Localizados no CSV: 55. Não localizado: CRP23.',
    'Critério dos selos: classificação registrada na coluna nivel_2026 do CSV.', '',
]
for label, count in summary:
    text.append(f'{label}: {count} ({num(Decimal(count) / 55 * 100)}% dos 55 localizados).')
text += [
    '', 'Com selo registrado: 22 de 55 (40,0%).',
    'Sem selo registrado: 33 de 55 (60,0%).',
    'Sem informação: 1 (CRP23), fora dos percentuais acima.', '',
    '2. RESULTADO POR TIPO DE ÓRGÃO',
    'Tipo               Diamante  Ouro  Prata  Sem selo  Total',
    'Câmaras municipais        8     0      2        22     32',
    'Prefeituras               5     4      3        11     23',
    'Total                    13     4      5        33     55', '',
    '3. COMO INTERPRETAR OS RESULTADOS',
    'Sem selo registrado reúne: 24 Elevado, 7 Intermediário e 2 Básico.',
    'Esses órgãos têm nota e classificação no CSV; não são registros ausentes.',
    'A nota sozinha não foi usada para atribuir um selo neste relatório.',
    'Existem 46 órgãos com nota entre 75 e 100, mas apenas 22 aparecem como',
    'Diamante, Ouro ou Prata no campo nivel_2026. Os outros 24 constam como',
    'Elevado e têm essenciais_2026 inferior a 100 no arquivo fornecido.',
    'Por isso, os 46 banners gerados por faixa de nota não representam 46 selos registrados.', '',
    '4. ÓRGÃOS COM SELO REGISTRADO (22)',
]
for level in ['Diamante', 'Ouro', 'Prata']:
    group = [r for r in certified if r['nivel'] == level]
    text += ['', f'{level.upper()} ({len(group)})']
    for r in group:
        text.append(f"{r['tipo']} {r['cidade']} / {r['uf']} - Nota: {num(r['nota'])}%")
text += ['', '5. ÓRGÃOS SEM SELO REGISTRADO (33)', 'Órgão | UF | Nota 2026 | Classificação no CSV | Essenciais 2026']
for r in without:
    text.append(f"{r['tipo']} {r['cidade']} | {r['uf']} | {num(r['nota'])}% | {r['nivel']} | {num(r['essenciais'])}%")
text += [
    '', '6. ÓRGÃO NÃO LOCALIZADO',
    'CRP23: sem registro identificado no CSV fornecido; não é possível atribuir nota ou selo.', '',
    '7. FONTE E MÉTODO',
    'Fonte: p7-lista-2026.csv, fornecido pelo cliente.',
    'Clientes: relação informada na conversa, com 55 Câmaras/Prefeituras cadastradas em',
    'Banner/nota_avalia.json e CRP23 informado separadamente.',
    'Cruzamento: município, UF, poder e esfera municipal; uma correspondência por cliente.',
    'Campos utilizados: indice_2026, nivel_2026 e essenciais_2026.',
    'CM = Câmara Municipal. PM = Prefeitura Municipal.',
    'Notas e selos refletem o arquivo fornecido, sem verificação externa ou atualização posterior.',
]
TXT.write_text('\n'.join(text) + '\n', encoding='utf-8-sig')

pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold', 'C:/Windows/Fonts/arialbd.ttf'))
NAVY = colors.HexColor('#17354C')
TEAL = colors.HexColor('#087F8C')
PALE = colors.HexColor('#EEF4F7')
GRAY = colors.HexColor('#52616B')
styles = {
    'title': ParagraphStyle('title', fontName='Arial-Bold', fontSize=23, leading=27, textColor=NAVY, spaceAfter=10),
    'heading': ParagraphStyle('heading', fontName='Arial-Bold', fontSize=13, leading=17, textColor=NAVY, spaceBefore=15, spaceAfter=7),
    'body': ParagraphStyle('body', fontName='Arial', fontSize=10, leading=14, textColor=NAVY, spaceAfter=7),
    'small': ParagraphStyle('small', fontName='Arial', fontSize=8.5, leading=11.5, textColor=GRAY, spaceAfter=5),
    'cell': ParagraphStyle('cell', fontName='Arial', fontSize=9, leading=11, textColor=NAVY),
}
def para(value, kind='body'):
    return Paragraph(escape(value), styles[kind])

def table(data, widths, row_height=None):
    t = Table(data, colWidths=widths, repeatRows=1, rowHeights=row_height, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('FONTNAME', (0,0),(-1,-1), 'Arial'), ('FONTSIZE', (0,0),(-1,-1), 9),
        ('FONTNAME',(0,0),(-1,0),'Arial-Bold'), ('BACKGROUND',(0,0),(-1,0),NAVY),
        ('TEXTCOLOR',(0,0),(-1,0),colors.white), ('TEXTCOLOR',(0,1),(-1,-1),NAVY),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'), ('LEFTPADDING',(0,0),(-1,-1),7),
        ('RIGHTPADDING',(0,0),(-1,-1),7), ('TOPPADDING',(0,0),(-1,-1),6),
        ('BOTTOMPADDING',(0,0),(-1,-1),6),
    ]))
    return t

story = [para('Órgãos clientes', 'title'), para('Resultados de transparência em 2026', 'heading'),
         para('Emitido em 10/11/2026. Classificações conforme o CSV fornecido.', 'small'),
         para('56 clientes na relação: 55 localizados no arquivo e 1 sem registro identificado (CRP23).')]
story.append(table([['Resultado no CSV','Órgãos','% dos 55 localizados']] + [[label,str(count),num(Decimal(count)/55*100)+'%'] for label,count in summary], [270,75,170]))
story += [Spacer(1,10), para('22 órgãos com selo registrado (40,0%). O CRP23 fica separado por falta de informação na fonte.'),
          para('Resultado por tipo de órgão','heading')]
story.append(table([['Órgão','Diamante','Ouro','Prata','Sem selo','Total'],['Câmaras','8','0','2','22','32'],['Prefeituras','5','4','3','11','23'],['Total','13','4','5','33','55']], [145,81,60,60,89,80]))
story += [para('Nota e selo registrado são informações diferentes','heading'),
          para('46 clientes têm nota entre 75 e 100, mas apenas 22 estão classificados como Diamante, Ouro ou Prata no CSV. Outros 24 aparecem como Elevado e têm o campo de critérios essenciais abaixo de 100.'),
          para('Assim, os 46 banners gerados por faixa de nota não equivalem a 46 selos registrados. Neste relatório, o selo segue o campo nivel_2026; a nota segue indice_2026.'),
          para('Fonte e abrangência','heading'),
          para('Fonte: p7-lista-2026.csv. Clientes: relação informada na conversa, incluindo o CRP23. Correspondência por município, UF, poder e esfera municipal. CM = Câmara Municipal; PM = Prefeitura Municipal. Resultados limitados ao arquivo fornecido.', 'small'),
          PageBreak(), para('Clientes com selo registrado','title'),
          para('22 órgãos: 13 Diamante, 4 Ouro e 5 Prata.','body')]
cert_rows = [['Órgão cliente','UF','Nota 2026','Selo no CSV']]
for r in certified:
    cert_rows.append([para(f"{r['tipo']} {r['cidade']}",'cell'),r['uf'],num(r['nota'])+'%',r['nivel']])
story.append(table(cert_rows,[290,35,80,110]))
story += [Spacer(1,12),para('Os 22 órgãos deste grupo têm essenciais_2026 igual a 100 no CSV.', 'small'),
          PageBreak(),para('Clientes sem selo registrado','title'),
          para('33 órgãos com nota: 24 Elevado, 7 Intermediário e 2 Básico.','body'),
          para('Este grupo tem registros na fonte. O CRP23, não localizado, não está incluído nesta lista.','small')]
no_rows=[['Órgão cliente','UF','Nota','Nível no CSV','Essenciais']]
for r in without:
    no_rows.append([para(f"{r['tipo']} {r['cidade']}",'cell'),r['uf'],num(r['nota'])+'%',r['nivel'],num(r['essenciais'])+'%'])
no_table=table(no_rows,[245,28,57,105,80])
no_table.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3.5),('BOTTOMPADDING',(0,0),(-1,-1),3.5)]))
story.append(no_table)
story += [Spacer(1,10),para('Não localizado: CRP23. Sem nota ou selo atribuídos neste relatório.', 'small')]

def footer(c, doc):
    c.saveState()
    c.setStrokeColor(colors.HexColor('#D4E0E7'));c.line(40,39,A4[0]-40,39)
    c.setFont('Arial',8);c.setFillColor(GRAY)
    c.drawString(40,26,'Clientes | PNTP 2026 | Fonte: p7-lista-2026.csv')
    c.drawRightString(A4[0]-40,26,f'Página {doc.page}')
    c.restoreState()

doc = SimpleDocTemplate(str(PDF), pagesize=A4, leftMargin=40, rightMargin=40, topMargin=36,bottomMargin=49,
                        title='Órgãos clientes - Resultados de transparência em 2026', author='Relatório de clientes')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
saved=PdfReader(str(PDF))
assert len(saved.pages)==3, len(saved.pages)
alltext='\n'.join(p.extract_text() for p in saved.pages)
for r in results:
    assert f"{r['tipo']} {r['cidade']}" in alltext, r
assert 'CRP23' in alltext
print(json.dumps({'pdf':str(PDF),'txt':str(TXT),'paginas':len(saved.pages),'clientes':56,'localizados':55,'diamante':13,'ouro':4,'prata':5,'sem_selo':33,'nao_localizado':1}, ensure_ascii=True))
