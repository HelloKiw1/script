"""Atualiza notas, essenciais e niveis de 2026 com o CSV fornecido.

Uso: python Banner/importar-notas-csv.py caminho/para/p7-lista-2026.csv
Depois: node Banner/build-local-resources.cjs
"""
import csv
import json
import sys
import unicodedata
from collections import Counter
from pathlib import Path

def normalizar(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.casefold()) if not unicodedata.combining(c))

def main():
    source = Path(sys.argv[1])
    target = Path(__file__).resolve().parent / 'nota_avalia.json'
    clients = json.loads(target.read_text(encoding='utf-8-sig'))
    with source.open(encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle, delimiter=';'))
    codes = set()
    for client in clients:
        uf = client.get('estado') or client.get('uf') or ('AM' if client['cidade'] in ['Envira', 'São Gabriel da Cachoeira'] else 'TO')
        power = 'Legislativo' if normalizar(client['orgão']).startswith('camara') else 'Executivo'
        matches = [r for r in rows if normalizar(r['municipio']) == normalizar(client['cidade']) and r['uf'] == uf and r['poder'] == power and r['esfera'] == 'Municipal']
        if len(matches) != 1:
            raise ValueError(f"Correspondencia ausente ou ambigua: {client['cidade']} / {power} / {uf}")
        row = matches[0]
        if row['codigo'] in codes:
            raise ValueError('Registro do CSV associado a mais de um cliente')
        codes.add(row['codigo'])
        for source_key, target_key in [('indice_2026', 'nota_2026'), ('essenciais_2026', 'essenciais_2026')]:
            value = float(row[source_key]) if row[source_key].strip() else None
            if value is not None and not 0 <= value <= 100:
                raise ValueError(f'Percentual invalido: {source_key}')
            client[target_key] = value
        client['nivel_2026'] = row['nivel_2026'] or None
    target.write_text(json.dumps(clients, ensure_ascii=False, indent=4) + '\n', encoding='utf-8')
    print(json.dumps({'atualizados': len(clients), 'niveis': dict(Counter(c['nivel_2026'] for c in clients))}, ensure_ascii=True))

if __name__ == '__main__':
    main()
