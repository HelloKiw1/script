"""Tema compartilhado da interface desktop, sem dependências adicionais."""
from __future__ import annotations

from typing import Any


FUNDO = '#f3f6fc'
AZUL = '#2563eb'
MARINHO = '#142d50'
TEXTO = '#263750'
SUAVE = '#687b95'
BORDA = '#e0e7f2'


def painel_arredondado(pai: Any, padding: int, escala: float) -> Any:
    """Usa uma moldura nativa e desenha o fundo sem interferir na geometria dos filhos."""
    import tkinter as tk

    moldura = tk.Frame(pai, background=FUNDO, padx=padding, pady=padding, borderwidth=0)
    fundo = tk.Canvas(moldura, background=FUNDO, highlightthickness=0, takefocus=0)
    fundo.place(x=-padding, y=-padding, relwidth=1, relheight=1, width=2 * padding, height=2 * padding)
    moldura.tk.call('lower', str(fundo))

    def redesenhar(evento: Any) -> None:
        if evento.widget is not moldura:
            return
        w, h = evento.width, evento.height
        raio = min(round(32 * escala), w // 2, h // 2)
        fundo.delete('all')
        def forma(y: int, cor: str, borda: str) -> None:
            x1, y1, x2, y2 = 1, y, w - 1, h - round(3 * escala) + y - 1
            pontos = (x1 + raio, y1, x2 - raio, y1, x2, y1, x2, y1 + raio,
                      x2, y2 - raio, x2, y2, x2 - raio, y2, x1 + raio, y2,
                      x1, y2, x1, y2 - raio, x1, y1 + raio, x1, y1)
            fundo.create_polygon(pontos, smooth=True, splinesteps=24, fill=cor, outline=borda)
        forma(round(3 * escala), '#e7edf7', '#e7edf7')
        forma(0, 'white', '#e3eaf5')
    moldura.bind('<Configure>', redesenhar)
    return moldura


def arredondar_controles(raiz: Any, estilo: Any, escala: float) -> None:
    """Desenha superfícies suaves com Pillow e mantém os widgets e atalhos nativos."""
    try:
        from PIL import Image, ImageDraw, ImageTk
    except ImportError:
        # A primeira abertura deve continuar permitindo instalar as dependências.
        return
    u = lambda valor: max(1, round(valor * escala))
    imagens = raiz._imagens_tema = []

    def superficie(cor: str, borda: str, raio: int = 12, sombra: bool = False, altura: int = 56) -> Any:
        tamanho, altura_px, fator = u(56), u(altura), 4
        imagem = Image.new('RGBA', (tamanho * fator, altura_px * fator))
        desenho = ImageDraw.Draw(imagem)
        if sombra:
            desenho.rounded_rectangle((0, u(3) * fator, tamanho * fator - 1, altura_px * fator - 1),
                                      radius=u(raio) * fator, fill='#e7edf7')
        desenho.rounded_rectangle((fator, fator, tamanho * fator - fator,
                                   altura_px * fator - u(3 if sombra else 1) * fator),
                                  radius=u(raio) * fator, fill=cor, outline=borda, width=fator)
        foto = ImageTk.PhotoImage(imagem.resize((tamanho, altura_px), Image.Resampling.LANCZOS), master=raiz)
        imagens.append(foto)
        return foto

    def elemento(nome: str, normal: Any, estados: list = (), raio: int = 12, altura: int = 0, largura: int = 0) -> None:
        lateral = u(raio + 2)
        vertical = min(lateral, u(altura // 2)) if altura else lateral
        estilo.element_create(nome, 'image', normal, *estados, border=(lateral, vertical, lateral, vertical), padding=0,
                               width=u(largura) if largura else 0, height=u(altura) if altura else 0, sticky='nsew')

    def substituir(layout: list, anterior: str, novo: str) -> list:
        resultado = []
        for nome, opcoes in layout:
            opcoes = dict(opcoes)
            if 'children' in opcoes:
                opcoes['children'] = substituir(opcoes['children'], anterior, novo)
            resultado.append((novo if nome == anterior else nome, opcoes))
        return resultado

    for nome, cor in (('Destaque.TLabel', '#eaf1ff'), ('Sucesso.TLabel', '#e8f6ee'),
                       ('Aviso.TLabel', '#fff3df'), ('Cabecalho.TLabel', '#27466c')):
        elemento_nome = 'Moderno.' + nome
        elemento(elemento_nome, superficie(cor, cor, 10), raio=10)
        estilo.layout(nome, [(elemento_nome, {'sticky': 'nsew', 'children': [
            ('Label.padding', {'sticky': 'nsew', 'children': [('Label.label', {'sticky': 'nsew'})]})]})])
        estilo.configure(nome, background=MARINHO if nome == 'Cabecalho.TLabel' else 'white')

    for nome, cor, hover, press, contorno, texto in (
        ('TButton', 'white', '#f0f5ff', '#e4edff', '#dce5f3', TEXTO),
        ('Azul.TButton', AZUL, '#1d54ce', '#1946ac', AZUL, 'white'),
    ):
        elemento_nome = 'Moderno.primary' if nome == 'Azul.TButton' else 'Moderno.button'
        elemento(elemento_nome, superficie(cor, contorno), [
            ('disabled', superficie('#eef2f8', '#e5ebf3')),
            ('pressed', superficie(press, press)),
            ('active', superficie(hover, '#94b4f8' if nome == 'TButton' else hover)),
            ('focus', superficie(cor, '#83a8fa')),
        ])
        estilo.layout(nome, [(elemento_nome, {'sticky': 'nsew', 'children': [
            ('Button.padding', {'sticky': 'nsew', 'children': [('Button.label', {'sticky': 'nsew'})]})]})])
        estilo.configure(nome, background='white', foreground=texto, padding=(u(16), u(11)),
                         font=('Segoe UI Semibold', 10), borderwidth=0)
        estilo.map(nome, background=[('!disabled', 'white'), ('disabled', 'white')],
                   foreground=[('disabled', '#91a0b7'), ('!disabled', texto)])

    for nome, campo in (('TEntry', 'Entry.field'), ('TCombobox', 'Combobox.field'), ('TSpinbox', 'Spinbox.field')):
        elemento_nome = 'Moderno.' + nome
        elemento(elemento_nome, superficie('#f8faff', '#dce5f3', 10), [
            ('disabled', superficie('#f1f4fa', '#e5ebf3', 10)),
            ('focus', superficie('white', '#739df5', 10)),
        ], raio=10)
        estilo.layout(nome, substituir(estilo.layout(nome), campo, elemento_nome))
        estilo.configure(nome, background='white', fieldbackground='#f8faff', padding=(u(12), u(10)),
                         borderwidth=0, arrowcolor=SUAVE)

    elemento('Moderno.choice', superficie('white', 'white'), [
        ('selected', 'focus', superficie('#edf3ff', '#85aafb')),
        ('selected', superficie('#edf3ff', '#c4d7fd')),
        ('active', superficie('#f6f9ff', '#e1eafa')),
        ('focus', superficie('white', '#85aafb')),
    ])
    estilo.layout('TRadiobutton', [('Moderno.choice', {'sticky': 'nsew', 'children': [
        ('Radiobutton.padding', {'sticky': 'nsew', 'children': [
            ('Radiobutton.indicator', {'side': 'left'}), ('Radiobutton.label', {'side': 'left', 'sticky': 'nsew'})]})]})])
    estilo.configure('TRadiobutton', padding=(u(10), u(9)), font=('Segoe UI Semibold', 10))
    estilo.map('TRadiobutton', foreground=[('selected', '#1c54b9')])

    def interruptor(ativo: bool, desabilitado: bool = False) -> Any:
        largura, altura, fator = u(34), u(20), 4
        imagem = Image.new('RGBA', ((largura + u(10)) * fator, altura * fator))
        desenho = ImageDraw.Draw(imagem)
        cor = '#dbe3ef' if desabilitado else (AZUL if ativo else '#c8d4e6')
        desenho.rounded_rectangle((0, 0, largura * fator - 1, altura * fator - 1), radius=altura * fator / 2, fill=cor)
        x = largura - altura + u(3) if ativo else u(3)
        desenho.ellipse((x * fator, u(3) * fator, (x + altura - u(6)) * fator,
                         (altura - u(3)) * fator), fill='white')
        foto = ImageTk.PhotoImage(imagem.resize((largura + u(10), altura), Image.Resampling.LANCZOS), master=raiz)
        imagens.append(foto)
        return foto

    estilo.element_create('Moderno.switch', 'image', interruptor(False),
                           ('disabled', interruptor(False, True)), ('selected', interruptor(True)),
                           border=0, sticky='')
    estilo.layout('TCheckbutton', [('Checkbutton.padding', {'sticky': 'nsew', 'children': [
        ('Moderno.switch', {'side': 'left'}), ('Checkbutton.label', {'side': 'left', 'sticky': 'nsew'})]})])
    estilo.configure('TCheckbutton', padding=(0, u(7)), font=('Segoe UI', 10))
    # A margem pertence ao rótulo: o interruptor não usa o indicador clássico.
    estilo.configure('TCheckbutton', compound='left')

    elemento('Moderno.Progressbar.trough', superficie('#e8eef9', '#e8eef9', 6, altura=12), raio=4, altura=12)
    elemento('Moderno.Progressbar.pbar', superficie(AZUL, AZUL, 6, altura=12), raio=4, altura=12)
    layout = substituir(estilo.layout('Horizontal.TProgressbar'), 'Horizontal.Progressbar.trough', 'Moderno.Progressbar.trough')
    layout = substituir(layout, 'Horizontal.Progressbar.pbar', 'Moderno.Progressbar.pbar')
    estilo.layout('Horizontal.TProgressbar', layout)
    estilo.configure('Horizontal.TProgressbar', thickness=u(12), background='white')
    elemento('Moderno.Scrollbar.trough', superficie(FUNDO, FUNDO, 6), raio=4, largura=10)
    elemento('Moderno.Scrollbar.thumb', superficie('#c5d2e7', '#c5d2e7', 6),
             [('active', superficie('#a8bcda', '#a8bcda', 6))], raio=4, largura=10, altura=24)
    estilo.layout('Vertical.TScrollbar', [('Moderno.Scrollbar.trough', {'sticky': 'nsew', 'children': [
        ('Moderno.Scrollbar.thumb', {'sticky': 'nsew', 'unit': 1})]})])


def configurar_tema(raiz: Any, ttk: Any) -> float:
    """Dimensiona controles e espaços na mesma escala das fontes do sistema."""
    from tkinter import font as tkfont

    escala = max(1.0, float(raiz.tk.call('tk', 'scaling')) / (96 / 72))
    u = lambda valor: round(valor * escala)
    estilo = ttk.Style(raiz)
    estilo.theme_use('clam')
    raiz.configure(background=FUNDO)
    for nome in ('TkDefaultFont', 'TkTextFont'):
        tkfont.nametofont(nome, root=raiz).configure(family='Segoe UI', size=10)
    raiz.option_add('*TCombobox*Listbox.font', ('Segoe UI', 10))
    estilo.configure('.', font=('Segoe UI', 10), background='white', foreground=TEXTO)
    estilo.configure('TFrame', background='white')
    estilo.configure('Fundo.TFrame', background=FUNDO)
    estilo.configure('Cartao.TFrame', background='white', bordercolor=BORDA, borderwidth=1, relief='solid')
    estilo.configure('TLabel', background='white', foreground=TEXTO)
    estilo.configure('Titulo.TLabel', font=('Segoe UI Semibold', 18), foreground=MARINHO)
    estilo.configure('Secao.TLabel', font=('Segoe UI Semibold', 12), foreground=MARINHO)
    estilo.configure('Subtitulo.TLabel', foreground=SUAVE)
    estilo.configure('Legenda.TLabel', font=('Segoe UI', 9), foreground=SUAVE)
    estilo.configure('Fundo.TLabel', background=FUNDO, foreground=SUAVE)
    estilo.configure('Destaque.TLabel', background='#eaf2ff', foreground=AZUL,
                     font=('Segoe UI Semibold', 10), padding=(u(10), u(6)))
    estilo.configure('Sucesso.TLabel', background='#e7f5ee', foreground='#216342',
                     font=('Segoe UI Semibold', 10), padding=(u(10), u(6)))
    estilo.configure('Aviso.TLabel', background='#fff3df', foreground='#855512',
                     font=('Segoe UI Semibold', 10), padding=(u(10), u(6)))
    estilo.configure('Cabecalho.TLabel', background=MARINHO, foreground='#e3edfa',
                     font=('Segoe UI Semibold', 10), padding=(u(12), u(7)))
    estilo.configure('TButton', padding=(u(14), u(8)), background='white', foreground=TEXTO,
                     bordercolor=BORDA, lightcolor='white', darkcolor='white', borderwidth=1,
                     focusthickness=2, focuscolor=AZUL, anchor='center')
    estilo.map('TButton', background=[('disabled', '#f4f6f9'), ('pressed', '#dce8f8'), ('active', '#edf3fc')],
               foreground=[('disabled', '#8b99ab')], bordercolor=[('focus', AZUL), ('active', '#9bb8de')])
    estilo.configure('Azul.TButton', background=AZUL, foreground='white', bordercolor=AZUL,
                     lightcolor=AZUL, darkcolor=AZUL, font=('Segoe UI Semibold', 10))
    estilo.map('Azul.TButton', background=[('disabled', '#cad7e8'), ('pressed', '#0c3f88'), ('active', '#0d4da5')],
               foreground=[('disabled', '#66788e'), ('!disabled', 'white')],
               bordercolor=[('disabled', '#cad7e8'), ('!disabled', AZUL)])
    for nome in ('TEntry', 'TCombobox', 'TSpinbox'):
        estilo.configure(nome, padding=(u(10), u(8)), fieldbackground='white', background='#edf2f8',
                         foreground=TEXTO, bordercolor='#bdcbdd', lightcolor='white', darkcolor='white',
                         arrowcolor=SUAVE, arrowsize=u(14), insertcolor=TEXTO)
        estilo.map(nome, bordercolor=[('focus', AZUL), ('!disabled', '#bdcbdd')],
                   fieldbackground=[('disabled', '#f1f4f8'), ('readonly', 'white')],
                   foreground=[('disabled', '#8b99ab')])
    for nome in ('TRadiobutton', 'TCheckbutton'):
        estilo.configure(nome, background='white', foreground=TEXTO, padding=(0, u(5)),
                         indicatorsize=u(15), indicatorbackground='white', indicatorforeground=AZUL,
                         upperbordercolor='#a7b8ce', lowerbordercolor='#a7b8ce',
                         indicatormargin=(0, u(2), u(8), u(2)))
        estilo.map(nome, background=[('active', 'white')],
                   indicatorbackground=[('!disabled', 'white')],
                   indicatorforeground=[('selected', AZUL)])
    estilo.configure('TSeparator', background=BORDA)
    estilo.configure('TProgressbar', background=AZUL, troughcolor='#e7eef7', bordercolor='#e7eef7',
                     borderwidth=0, lightcolor=AZUL, darkcolor=AZUL, thickness=u(10))
    estilo.configure('Vertical.TScrollbar', background='#c4d0df', troughcolor=FUNDO,
                     borderwidth=0, arrowsize=u(12))
    arredondar_controles(raiz, estilo, escala)
    return escala
