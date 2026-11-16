"""Abre a página local do Relatório Barco ou processa um PDF pelo terminal."""
from __future__ import annotations

import argparse
import importlib.util
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from ambiente import ATRICON, ENTRADA, PASTA
from motor import Cancelado, Opcoes, Processo, listar_orgaos
from visual import AZUL, BORDA, FUNDO, MARINHO, TEXTO, configurar_tema, painel_arredondado


def dependencias_ausentes() -> list[str]:
    """Confere módulos sem abrir navegador, consultar sites ou ler credenciais."""
    ausentes = []
    for nome in ('pymupdf', 'pypdf', 'reportlab', 'PIL', 'playwright.sync_api'):
        try:
            if importlib.util.find_spec(nome) is None:
                ausentes.append(nome)
        except (ModuleNotFoundError, ImportError):
            ausentes.append(nome)
    return ausentes


def instalar(informar: Any = print) -> None:
    """Instala dependências isoladas nesta pasta e o Chromium do Playwright."""
    comandos = [
        [sys.executable, '-m', 'pip', 'install', '--target', str(PASTA / '.dependencias'), '--upgrade', '-r', str(PASTA / 'requirements.txt')],
        [sys.executable, '-m', 'playwright', 'install', 'chromium'],
    ]
    ambiente = dict(os.environ)
    ambiente['PYTHONPATH'] = str(PASTA / '.dependencias')
    for indice, comando in enumerate(comandos):
        informar(f'Instalação {indice + 1}/2: ' + ('bibliotecas Python' if indice == 0 else 'navegador Chromium'))
        processo = subprocess.Popen(comando, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                   encoding='utf-8', errors='replace', env=ambiente,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        for linha in processo.stdout:
            informar(linha.rstrip())
        if processo.wait() != 0:
            raise RuntimeError('A instalação falhou. Veja a mensagem acima e execute novamente.')


def abrir(caminho: Path) -> None:
    """Abre um artefato local pelo programa padrão do Windows."""
    if os.name == 'nt':
        os.startfile(str(caminho.resolve()))
    else:
        import webbrowser
        webbrowser.open(caminho.resolve().as_uri())


class Janela:
    """Interface Tk com seleção substituída pelo progresso durante o processamento."""

    def __init__(self, raiz: Any) -> None:
        """Cria a tela inicial e uma fila para atualização segura pela thread de trabalho."""
        import tkinter as tk
        from tkinter import ttk
        self.tk, self.ttk, self.raiz = tk, ttk, raiz
        self.fila: queue.Queue = queue.Queue()
        self.cancelar = threading.Event()
        self.trabalhando = False
        self.resultado: dict = {}
        self.opcoes_anteriores: Opcoes | None = None
        self.orgaos: list[dict] = []
        self._ajuste_cartoes: str | None = None
        self.raiz.title('Barco Digital | Relatórios PNTP 2026')
        self.escala = configurar_tema(raiz, ttk)
        u = self.u
        largura = min(u(1180), raiz.winfo_screenwidth() - u(60))
        altura = min(u(900), raiz.winfo_screenheight() - u(90))
        self.raiz.geometry(f'{largura}x{altura}')
        self.raiz.minsize(min(u(760), largura), min(u(580), altura))
        cabecalho = tk.Frame(raiz, bg=MARINHO, padx=u(28), pady=u(18))
        cabecalho.pack(fill='x')
        logo = ATRICON / 'assets/logo-da-empresa.png'
        self.logo = None
        if logo.exists():
            try:
                self.logo = tk.PhotoImage(file=str(logo))
                fator = max(1, round(max(self.logo.width(), self.logo.height()) / u(48)))
                self.logo = self.logo.subsample(fator)
                tk.Label(cabecalho, image=self.logo, bg=MARINHO).pack(side='left', padx=(0, u(16)))
            except tk.TclError:
                pass
        ttk.Label(cabecalho, text='PNTP 2026', style='Cabecalho.TLabel').pack(side='right', padx=(u(16), 0))
        tk.Label(cabecalho, text='Relatórios Barco Digital', bg=MARINHO, fg='white', font=('Segoe UI Semibold', 20)).pack(anchor='w')
        subtitulo = tk.Label(cabecalho, text='Evidências organizadas. Revisão e relatório em um só lugar.', bg=MARINHO,
                            fg='#c6d7ec', font=('Segoe UI', 10))
        subtitulo.pack(anchor='w', pady=(u(4), 0))
        def ajustar_cabecalho(evento: Any) -> None:
            if evento.widget is not raiz:
                return
            compacto = evento.height < u(700)
            if compacto == getattr(self, '_cabecalho_compacto', None):
                return
            self._cabecalho_compacto = compacto
            cabecalho.configure(pady=u(10 if compacto else 18))
            if compacto:
                subtitulo.pack_forget()
            else:
                subtitulo.pack(anchor='w', pady=(u(4), 0))
        raiz.bind('<Configure>', ajustar_cabecalho, add='+')
        area = ttk.Frame(raiz, style='Fundo.TFrame')
        area.pack(fill='both', expand=True)
        self.corpo = ttk.Frame(area, style='Fundo.TFrame')
        area.bind('<Configure>', lambda evento: self.corpo.place(
            relx=.5, y=u(20), anchor='n', width=min(u(1140), max(1, evento.width - u(40))),
            height=max(1, evento.height - u(40))))
        self.selecao = ttk.Frame(self.corpo, style='Fundo.TFrame')
        self.selecao.pack(fill='both', expand=True)
        self.rodape = painel_arredondado(self.selecao, u(14), self.escala)
        self.rodape.pack(side='bottom', fill='x')
        self.rolagem = tk.Canvas(self.selecao, background=FUNDO, highlightthickness=0, yscrollincrement=u(20))
        self.barra_vertical = ttk.Scrollbar(self.selecao, orient='vertical', command=self.rolagem.yview)
        self.rolagem.configure(yscrollcommand=self.barra_vertical.set)
        self.rolagem.pack(side='left', fill='both', expand=True)
        self.formulario = ttk.Frame(self.rolagem, style='Fundo.TFrame')
        self.janela_formulario = self.rolagem.create_window((0, 0), window=self.formulario, anchor='nw')
        self.formulario.bind('<Configure>', self.ajustar_rolagem)
        self.rolagem.bind('<Configure>', self.ajustar_formulario)
        self.raiz.bind('<MouseWheel>', self.rolar_formulario, add='+')
        self.raiz.bind('<FocusIn>', self.revelar_campo, add='+')
        self.montar_selecao()
        self.progresso = ttk.Frame(self.corpo, style='Fundo.TFrame')
        self.montar_progresso()
        self.raiz.protocol('WM_DELETE_WINDOW', self.fechar)
        self._atualizacao = self.raiz.after(150, self.atualizar)

    def u(self, valor: float) -> int:
        """Converte espaçamentos de referência para a escala da tela."""
        return round(valor * self.escala)

    def texto(self, pai: Any, texto: str = '', **opcoes: Any) -> Any:
        """Quebra textos de apoio conforme a largura disponível, inclusive caminhos."""
        rotulo = self.ttk.Label(pai, text=texto, **opcoes)
        largura_anterior = None
        def ajustar_texto(evento: Any) -> None:
            nonlocal largura_anterior
            largura = max(1, evento.width)
            if largura != largura_anterior:
                largura_anterior = largura
                rotulo.configure(wraplength=largura)
            self.agendar_ajuste_cartoes()
        rotulo.bind('<Configure>', ajustar_texto)
        return rotulo

    def cartao(self, pai: Any, titulo: str, descricao: str) -> Any:
        """Agrupa uma etapa do formulário com título, apoio e espaços consistentes."""
        caixa = painel_arredondado(pai, self.u(18), self.escala)
        self.ttk.Label(caixa, text=titulo, style='Secao.TLabel').pack(anchor='w')
        self.texto(caixa, descricao, style='Subtitulo.TLabel').pack(fill='x', pady=(self.u(4), self.u(12)))
        return caixa

    def ajustar_formulario(self, evento: Any) -> None:
        """Empilha os cartões em janelas estreitas e limita a expansão dos campos."""
        if getattr(self, '_largura_formulario', None) != evento.width:
            self._largura_formulario = evento.width
            self.rolagem.itemconfigure(self.janela_formulario, width=evento.width)
        if hasattr(self, 'cartao_revisao'):
            self.ajustar_cartoes()
        self.ajustar_rolagem()

    def agendar_ajuste_cartoes(self, evento: Any = None) -> None:
        """Agrupa pedidos de altura após a quebra dos textos, sem realimentar o grid."""
        if hasattr(self, 'cartao_coleta') and self._ajuste_cartoes is None:
            self._ajuste_cartoes = self.raiz.after_idle(self.ajustar_cartoes)

    def ajustar_cartoes(self) -> None:
        """Define larguras explícitas e mede alturas para evitar ciclos de geometria."""
        if self._ajuste_cartoes:
            self.raiz.after_cancel(self._ajuste_cartoes)
            self._ajuste_cartoes = None
        largura = max(1, self.rolagem.winfo_width())
        self._duas_colunas = largura >= self.u(980)
        espaco = self.u(14)
        h1, h2 = self.cartao_revisao.winfo_reqheight(), self.cartao_coleta.winfo_reqheight()
        if self._duas_colunas:
            w1 = round((largura - espaco) * .6)
            h = max(h1, h2)
            posicoes = ((0, 0, w1, h), (w1 + espaco, 0, largura - w1 - espaco, h))
        else:
            h = h1 + espaco + h2
            posicoes = ((0, 0, largura, h1), (0, h1 + espaco, largura, h2))
        dimensoes = (largura, h, posicoes)
        if getattr(self, '_dimensoes_cartoes', None) == dimensoes:
            return
        self._dimensoes_cartoes = dimensoes
        self.configuracoes.configure(height=h)
        for cartao, (x, y, w, altura) in zip((self.cartao_revisao, self.cartao_coleta), posicoes):
            cartao.place(x=x, y=y, width=w, height=altura)

    def ajustar_rolagem(self, evento: Any = None) -> None:
        """Exibe a barra somente quando o conteúdo ultrapassa a área de leitura."""
        regiao = self.rolagem.bbox('all')
        if getattr(self, '_regiao_rolagem', None) != regiao:
            self._regiao_rolagem = regiao
            self.rolagem.configure(scrollregion=regiao)
        if self.formulario.winfo_reqheight() > self.rolagem.winfo_height() + 2:
            if not self.barra_vertical.winfo_manager():
                self.barra_vertical.pack(side='right', fill='y', before=self.rolagem, padx=(self.u(8), 0))
        elif self.barra_vertical.winfo_manager():
            self.barra_vertical.pack_forget()
            self.rolagem.yview_moveto(0)

    def rolar_formulario(self, evento: Any) -> None:
        """Permite usar a roda sobre o formulário sem interferir em listas e logs."""
        if not self.selecao.winfo_ismapped() or not self.barra_vertical.winfo_manager():
            return
        if evento.widget.winfo_class() in {'TCombobox', 'TSpinbox', 'Text'}:
            return
        self.rolagem.yview_scroll(-int(evento.delta / 120), 'units')

    def revelar_campo(self, evento: Any) -> None:
        """Mantém campos acessados pelo teclado dentro da região visível."""
        campo = evento.widget
        if not str(campo).startswith(str(self.formulario) + '.'):
            return
        topo = campo.winfo_rooty() - self.formulario.winfo_rooty()
        inicio = self.rolagem.canvasy(0)
        altura = self.rolagem.winfo_height()
        fim = topo + campo.winfo_height() + self.u(12)
        total = max(1, self.formulario.winfo_height())
        if topo < inicio:
            self.rolagem.yview_moveto(max(0, topo - self.u(12)) / total)
        elif fim > inicio + altura:
            self.rolagem.yview_moveto((fim - altura) / total)

    def montar_selecao(self) -> None:
        """Organiza entrada, revisão e coleta em cartões que se adaptam à janela."""
        ttk, tk, u = self.ttk, self.tk, self.u
        introducao = ttk.Frame(self.formulario, style='Fundo.TFrame')
        introducao.pack(fill='x', pady=(0, u(16)))
        ttk.Label(introducao, text='Novo relatório', style='Titulo.TLabel', background=FUNDO).pack(anchor='w')
        self.texto(introducao, 'Prepare as evidências e continue a revisão no Codex do VS Code.',
                   style='Fundo.TLabel').pack(fill='x', pady=(u(4), 0))
        entrada = self.cartao(self.formulario, '01  Relatório de entrada',
                              'Use um PDF original ou encontre o órgão no cadastro do Avalia.')
        entrada.pack(fill='x', pady=(0, u(14)))
        self.origem = tk.StringVar(value='pdf')
        self.arquivo = tk.StringVar()
        self.cadastro = tk.StringVar(value=str(ATRICON / 'entrada/orgaos_avalia.json'))
        self.orgao = tk.StringVar()
        linha = ttk.Frame(entrada)
        linha.pack(fill='x')
        ttk.Radiobutton(linha, text='Selecionar PDF original', variable=self.origem, value='pdf').pack(side='left')
        ttk.Radiobutton(linha, text='Buscar órgão no Avalia', variable=self.origem, value='orgao').pack(side='left', padx=(u(22), 0))
        self.entrada_pdf = ttk.Frame(entrada)
        ttk.Label(self.entrada_pdf, text='Arquivo PDF', style='Legenda.TLabel').pack(anchor='w', pady=(u(10), u(5)))
        linha = ttk.Frame(self.entrada_pdf)
        linha.pack(fill='x')
        linha.columnconfigure(0, weight=1)
        self.campo_pdf = ttk.Entry(linha, textvariable=self.arquivo)
        self.campo_pdf.grid(row=0, column=0, sticky='nsew')
        ttk.Button(linha, text='Escolher PDF…', width=16, command=self.escolher_pdf).grid(row=0, column=1, padx=(u(10), 0))
        self.entrada_orgao = ttk.Frame(entrada)
        ttk.Label(self.entrada_orgao, text='Órgão ou cidade', style='Legenda.TLabel').pack(anchor='w', pady=(u(10), u(5)))
        linha = ttk.Frame(self.entrada_orgao)
        linha.pack(fill='x')
        linha.columnconfigure(0, weight=1)
        self.combo = ttk.Combobox(linha, textvariable=self.orgao, height=12)
        self.combo.grid(row=0, column=0, sticky='nsew')
        self.combo.bind('<KeyRelease>', self.filtrar_orgaos)
        self.combo.bind('<<ComboboxSelected>>', lambda evento: self.origem.set('orgao'))
        ttk.Button(linha, text='Cadastro…', width=16, command=self.escolher_cadastro).grid(row=0, column=1, padx=(u(10), 0))
        self.info_cadastro = self.texto(self.entrada_orgao, style='Legenda.TLabel')
        self.info_cadastro.pack(fill='x', pady=(u(6), 0))
        self.carregar_orgaos()
        self.origem.trace_add('write', self.atualizar_origem)
        self.atualizar_origem()
        self.configuracoes = ttk.Frame(self.formulario, style='Fundo.TFrame')
        self.configuracoes.pack(fill='x')
        revisao = self.cartao_revisao = self.cartao(self.configuracoes, '02  Revisão no Codex',
                                                  'O programa prepara os arquivos. Você revisa no VS Code.')
        revisao.bind('<Configure>', self.agendar_ajuste_cartoes, add='+')
        self.modo = tk.StringVar(value='codex')
        ttk.Label(revisao, text='Sem chave de API', style='Destaque.TLabel').pack(anchor='w', pady=(0, u(12)))
        for titulo, descricao in (
            ('1. Gere o pré-PDF', 'As imagens ficam incorporadas no PDF. Os auxiliares são apagados.'),
            ('2. Copie o prompt para o Codex', 'O prompt explica a análise e o preenchimento de resposta_ia.json.'),
            ('3. Importe a revisão', 'O Codex pode gerar o PDF final, ou você pode importar a resposta aqui.'),
        ):
            ttk.Label(revisao, text=titulo, font=('Segoe UI Semibold', 10)).pack(anchor='w')
            self.texto(revisao, descricao, style='Legenda.TLabel').pack(fill='x', pady=(u(3), u(12)))
        coleta = self.cartao_coleta = self.cartao(self.configuracoes, '03  Opções de coleta',
                                                 'Ajuste a captura de páginas e documentos.')
        coleta.bind('<Configure>', self.agendar_ajuste_cartoes, add='+')
        self.visivel = tk.BooleanVar(value=False)
        ttk.Label(coleta, text='Somente PDF e prompt', style='Destaque.TLabel').pack(anchor='w', pady=(0, u(10)))
        self.texto(coleta, 'Imagens, anexos e JSONs são usados temporariamente. Ao encerrar, somente o PDF e o prompt ficam salvos.',
                   style='Legenda.TLabel').pack(fill='x', pady=(0, u(12)))
        ttk.Checkbutton(coleta, text='  Mostrar navegador na coleta', variable=self.visivel).pack(anchor='w')
        avancado = ttk.Frame(coleta)
        avancado.pack(fill='x', pady=(u(14), 0))
        avancado.columnconfigure(0, weight=1)
        ttk.Label(avancado, text='Espera (segundos)', style='Legenda.TLabel').grid(row=0, column=0, sticky='w', pady=(0, u(8)))
        self.espera = tk.IntVar(value=25)
        ttk.Spinbox(avancado, from_=5, to=90, textvariable=self.espera, width=5).grid(row=0, column=1, sticky='e', padx=(u(10), 0), pady=(0, u(8)))
        ttk.Label(avancado, text='Documentos por página', style='Legenda.TLabel').grid(row=1, column=0, sticky='w')
        self.documentos = tk.IntVar(value=3)
        ttk.Spinbox(avancado, from_=0, to=10, textvariable=self.documentos, width=5).grid(row=1, column=1, sticky='e', padx=(u(10), 0))
        self.texto(self.formulario, 'Sem revisão concluída, o PDF é salvo como rascunho. O prompt inclui os textos, as datas e as pendências. Arquivos auxiliares são excluídos automaticamente.',
                   style='Fundo.TLabel').pack(fill='x', pady=(u(14), u(18)))
        acoes = self.rodape
        ttk.Button(acoes, text='Gerar pré-PDF + prompt', style='Azul.TButton', command=self.iniciar).pack(side='right', padx=(u(12), 0))
        ttk.Button(acoes, text='Instalar dependências', command=self.instalar_dependencias).pack(side='left')
        ttk.Button(acoes, text='Importar revisão…', command=self.importar).pack(side='left', padx=(u(8), 0))

    def atualizar_origem(self, *args: Any) -> None:
        """Mostra apenas os campos correspondentes à origem selecionada."""
        self.entrada_pdf.pack_forget()
        self.entrada_orgao.pack_forget()
        painel = self.entrada_pdf if self.origem.get() == 'pdf' else self.entrada_orgao
        painel.pack(fill='x')

    def montar_progresso(self) -> None:
        """Prepara a tela de etapas, porcentagem e histórico do processamento."""
        ttk, u = self.ttk, self.u
        self.etapa = self.tk.StringVar(value='Preparando')
        self.percentual = self.tk.StringVar(value='0%')
        self.titulo_progresso = ttk.Label(self.progresso, text='Preparando o relatório', style='Titulo.TLabel', background=FUNDO)
        self.titulo_progresso.pack(anchor='w', pady=(0, u(14)))
        acoes = painel_arredondado(self.progresso, u(14), self.escala)
        acoes.pack(side='bottom', fill='x')
        resumo = painel_arredondado(self.progresso, u(18), self.escala)
        resumo.pack(fill='x')
        linha = ttk.Frame(resumo)
        linha.pack(fill='x')
        self.estado_progresso = ttk.Label(linha, text='Em andamento', style='Destaque.TLabel')
        self.estado_progresso.pack(side='left')
        ttk.Label(linha, textvariable=self.percentual, font=('Segoe UI Semibold', 16), foreground=AZUL).pack(side='right')
        self.entidade_progresso = self.texto(resumo, style='Subtitulo.TLabel')
        self.entidade_progresso.pack(fill='x', pady=(u(10), 0))
        self.texto(resumo, textvariable=self.etapa, style='Secao.TLabel').pack(fill='x', pady=(u(12), u(10)))
        self.barra = ttk.Progressbar(resumo, maximum=100, mode='determinate')
        self.barra.pack(fill='x')
        self.texto(resumo, 'O tempo de cada etapa varia conforme as páginas e os documentos.',
                   style='Legenda.TLabel').pack(fill='x', pady=(u(8), 0))
        historico = painel_arredondado(self.progresso, u(18), self.escala)
        historico.pack(fill='both', expand=True, pady=u(14))
        ttk.Label(historico, text='Histórico da execução', style='Secao.TLabel').pack(anchor='w', pady=(0, u(10)))
        painel_log = ttk.Frame(historico)
        painel_log.pack(fill='both', expand=True)
        self.log = self.tk.Text(painel_log, height=4, width=1, font=('Consolas', 10), bg='white', fg=TEXTO,
                                relief='flat', highlightthickness=0, highlightbackground=BORDA,
                                highlightcolor=AZUL, padx=u(12), pady=u(10), wrap='word', state='disabled')
        barra_log = ttk.Scrollbar(painel_log, orient='vertical', command=self.log.yview)
        barra_log.pack(side='right', fill='y')
        self.log.configure(yscrollcommand=barra_log.set)
        self.log.pack(side='left', fill='both', expand=True)
        self.acoes_navegacao = ttk.Frame(acoes)
        self.acoes_navegacao.pack(side='left')
        self.acoes_resultado = ttk.Frame(acoes)
        self.acoes_resultado.pack(side='right')
        acoes.bind('<Configure>', self.ajustar_acoes_progresso, add='+')
        acoes = self.acoes_navegacao
        self.botao_parar = ttk.Button(acoes, text='Cancelar', command=self.pedir_cancelamento)
        self.botao_parar.pack(side='left')
        self.botao_voltar = ttk.Button(acoes, text='Voltar ao início', command=self.voltar, state='disabled')
        self.botao_voltar.pack(side='left', padx=(u(8), 0))
        acoes = self.acoes_resultado
        self.botao_pdf = ttk.Button(acoes, text='Abrir PDF', style='Azul.TButton', command=lambda: self.abrir_resultado('arquivo'), state='disabled')
        self.botao_pdf.pack(side='right')
        self.botao_pacote = ttk.Button(acoes, text='Abrir pasta', command=lambda: self.abrir_resultado('pacote'), state='disabled')
        self.botao_pacote.pack(side='right', padx=u(8))
        self.botao_importar = ttk.Button(acoes, text='Importar revisão…', command=self.importar, state='disabled')
        self.botao_importar.pack(side='right')
        self.botao_prompt = ttk.Button(acoes, text='Copiar prompt', style='Azul.TButton', command=self.copiar_prompt, state='disabled')
        self.botao_prompt.pack(side='right', padx=(0, u(8)))

    def ajustar_acoes_progresso(self, evento: Any) -> None:
        """Separa navegação e arquivos em duas linhas quando não couberem lado a lado."""
        estreito = evento.width < (self.acoes_navegacao.winfo_reqwidth() + self.acoes_resultado.winfo_reqwidth() + self.u(44))
        if getattr(self, '_acoes_empilhadas', None) == estreito:
            return
        self._acoes_empilhadas = estreito
        self.acoes_navegacao.pack_forget()
        self.acoes_resultado.pack_forget()
        self.acoes_navegacao.pack(side='top' if estreito else 'left', anchor='w')
        self.acoes_resultado.pack(side='top' if estreito else 'right', anchor='e', pady=(self.u(10) if estreito else 0, 0))

    def carregar_orgaos(self) -> None:
        """Carrega rótulos públicos e mantém um erro de cadastro fora do fluxo de PDF local."""
        try:
            self.orgaos = listar_orgaos(Path(self.cadastro.get()))
        except Exception:
            self.orgaos = []
        self.combo['values'] = [o['rotulo'] for o in self.orgaos]
        self.info_cadastro.configure(text=(
            f'{len(self.orgaos)} {"órgão disponível" if len(self.orgaos) == 1 else "órgãos disponíveis"}. Digite para filtrar por nome ou cidade.' if self.orgaos
            else 'Nenhum órgão disponível. Escolha um cadastro JSON válido ou use um PDF local.'))

    def filtrar_orgaos(self, evento: Any = None) -> None:
        """Filtra por cidade ou nome, preservando o índice original do cadastro."""
        termo = self.orgao.get().casefold()
        self.combo['values'] = [o['rotulo'] for o in self.orgaos if termo in o['rotulo'].casefold()]
        if self.orgao.get() in [o['rotulo'] for o in self.orgaos]:
            self.origem.set('orgao')

    def escolher_pdf(self) -> None:
        """Abre seleção de um único documento original."""
        from tkinter import filedialog
        arquivo = filedialog.askopenfilename(parent=self.raiz, initialdir=str(ENTRADA), title='PDF original do Avalia', filetypes=[('PDF', '*.pdf')])
        if arquivo:
            self.arquivo.set(arquivo)
            self.origem.set('pdf')

    def escolher_cadastro(self) -> None:
        """Permite usar o mesmo cadastro JSON já utilizado pelo coletor."""
        from tkinter import filedialog
        arquivo = filedialog.askopenfilename(parent=self.raiz, initialdir=str(ATRICON / 'entrada'), filetypes=[('Cadastro JSON', '*.json')])
        if arquivo:
            self.cadastro.set(arquivo)
            self.carregar_orgaos()

    def obter_opcoes(self) -> Opcoes:
        """Valida a entrada antes de esconder a seleção e iniciar o trabalho."""
        if dependencias_ausentes():
            raise ValueError('Faltam dependências. Use o botão Instalar dependências e reabra o programa.')
        opcoes = Opcoes(modo='codex', cadastro=Path(self.cadastro.get()),
                        navegador_visivel=self.visivel.get(),
                        espera=self.espera.get(), documentos_pagina=self.documentos.get())
        if not 5 <= opcoes.espera <= 90 or not 0 <= opcoes.documentos_pagina <= 10:
            raise ValueError('Ajuste a espera (5 a 90 segundos) e documentos (0 a 10).')
        if self.origem.get() == 'pdf':
            opcoes.arquivo = Path(self.arquivo.get())
            if not opcoes.arquivo.is_file():
                raise ValueError('Selecione o PDF original.')
        else:
            orgao = next((o for o in self.orgaos if o['rotulo'] == self.orgao.get()), None)
            if not orgao:
                raise ValueError('Escolha um órgão da lista do cadastro.')
            opcoes.conta_indice = orgao['indice']
        return opcoes

    def iniciar(self, opcoes: Opcoes | None = None) -> None:
        """Esconde a seleção e inicia o motor fora da thread da interface."""
        from tkinter import messagebox
        if self.trabalhando:
            return
        try:
            opcoes = opcoes or self.obter_opcoes()
        except Exception as erro:
            messagebox.showerror('Confira a entrada', str(erro), parent=self.raiz)
            return
        self.opcoes_anteriores = opcoes
        self.resultado = {}
        self.cancelar.clear()
        self.trabalhando = True
        self.preparar_progresso('Importando revisão' if opcoes.modo == 'importar' else 'Preparando pré-PDF e prompt',
                                opcoes.arquivo.name if opcoes.arquivo else self.orgao.get())
        self.botao_parar.configure(state='normal')
        threading.Thread(target=self.executar, args=(opcoes,), daemon=True).start()

    def preparar_progresso(self, titulo: str, entidade: str = '') -> None:
        """Reinicia a apresentação para coleta, importação ou instalação."""
        self.selecao.pack_forget()
        self.progresso.pack(fill='both', expand=True)
        self.titulo_progresso.configure(text=titulo)
        self.entidade_progresso.configure(text=entidade)
        self.estado_progresso.configure(text='Em andamento', style='Destaque.TLabel')
        self.etapa.set('Preparando a execução…')
        for botao in (self.botao_parar, self.botao_pdf, self.botao_pacote, self.botao_importar, self.botao_voltar, self.botao_prompt):
            botao.configure(state='disabled')
        self.barra.stop()
        self.barra.configure(mode='determinate')
        self.barra['value'] = 0
        self.percentual.set('0%')
        self.log.configure(state='normal')
        self.log.delete('1.0', 'end')
        self.log.configure(state='disabled')

    def executar(self, opcoes: Opcoes) -> None:
        """Transmite somente progresso e resultados públicos para a janela."""
        processo = Processo(opcoes, lambda p, m: self.fila.put(('progresso', p, m)), self.cancelar)
        try:
            resultado = processo.executar()
            self.fila.put(('concluido', resultado))
        except Cancelado as erro:
            self.fila.put(('erro', str(erro), str(processo.pasta or '')))
        except Exception as erro:
            # Os módulos nunca exportam contas; aqui removemos também credenciais eventualmente citadas por bibliotecas.
            mensagem = str(erro)
            if opcoes.conta_indice is not None and processo.pasta is None:
                mensagem = f'{type(erro).__name__}: falha ao processar o órgão. Confira acesso no coletor, dependências e conexão. Nenhuma credencial foi registrada.'
            self.fila.put(('erro', mensagem, str(processo.pasta or '')))

    def registrar(self, mensagem: str) -> None:
        """Acrescenta uma etapa ao log visível, com rolagem automática."""
        self.log.configure(state='normal')
        self.log.insert('end', mensagem + '\n')
        self.log.see('end')
        self.log.configure(state='disabled')

    def atualizar(self) -> None:
        """Consome mensagens; todos os acessos Tk ocorrem nesta thread principal."""
        if self._atualizacao:
            self.raiz.after_cancel(self._atualizacao)
            self._atualizacao = None
        try:
            while True:
                item = self.fila.get_nowait()
                if item[0] == 'progresso':
                    self.barra['value'] = item[1]
                    self.percentual.set(f'{item[1]:.0f}%')
                    self.etapa.set(item[2])
                    self.registrar(item[2])
                elif item[0] == 'instalacao_log':
                    self.registrar(item[1])
                elif item[0] in {'concluido', 'erro', 'instalado'}:
                    self.trabalhando = False
                    self.barra.stop()
                    self.barra.configure(mode='determinate')
                    self.botao_parar.configure(state='disabled')
                    self.botao_voltar.configure(state='normal')
                    if item[0] == 'concluido':
                        self.resultado = item[1]
                        pendente = bool(item[1]['pendencias'])
                        preparado = bool(item[1].get('prompt')) and not item[1].get('revisao_importada')
                        self.titulo_progresso.configure(text='Pré-PDF e prompt prontos' if preparado else 'Relatório gerado')
                        self.estado_progresso.configure(text='Revisão pendente' if pendente else 'Concluído',
                                                       style='Aviso.TLabel' if pendente else 'Sucesso.TLabel')
                        self.etapa.set('Copie o prompt e cole no Codex do VS Code para revisar os comentários.' if preparado
                                       else ('Rascunho pronto para revisão' if pendente else 'Seu relatório está pronto'))
                        self.barra['value'] = 100
                        self.percentual.set('100%')
                        self.botao_pdf.configure(state='normal')
                        self.botao_pdf.configure(text='Abrir pré-PDF' if preparado else 'Abrir PDF', style='TButton' if preparado else 'Azul.TButton')
                        self.botao_pacote.configure(state='normal')
                        self.botao_importar.configure(state='normal')
                        self.botao_prompt.configure(state='normal' if item[1].get('prompt') else 'disabled')
                        if item[1].get('prompt'):
                            self.registrar(f'Prompt para o Codex: {item[1]["prompt"]}')
                        self.registrar(f'{item[1]["paginas"]} páginas. Saída: {item[1]["arquivo"]}')
                        self.registrar(f'PDF e prompt salvos em: {item[1]["pacote"]}')
                        if item[1]['pendencias']:
                            self.registrar(f'{len(item[1]["pendencias"])} pendências registradas no prompt. O PDF está identificado como rascunho.')
                        if item[1].get('somente_pdf_prompt'):
                            self.registrar('Imagens separadas e arquivos auxiliares excluídos automaticamente.')
                    elif item[0] == 'instalado':
                        self.titulo_progresso.configure(text='Instalação concluída')
                        self.estado_progresso.configure(text='Concluído', style='Sucesso.TLabel')
                        self.etapa.set('Instalação concluída. Feche e abra novamente o programa.')
                        self.barra['value'] = 100
                        self.percentual.set('100%')
                    else:
                        self.titulo_progresso.configure(text='Execução interrompida')
                        self.estado_progresso.configure(text='Interrompido', style='Aviso.TLabel')
                        self.etapa.set('Processamento interrompido')
                        if self.percentual.get() == 'Em curso':
                            self.percentual.set('—')
                        self.registrar(item[1])
                        if item[2]:
                            self.resultado = {'pacote': item[2]}
                            self.botao_pacote.configure(state='normal')
        except queue.Empty:
            pass
        self._atualizacao = self.raiz.after(150, self.atualizar)

    def importar(self) -> None:
        """Importa uma revisão e regenera sem repetir a coleta existente."""
        from tkinter import filedialog, messagebox
        if self.trabalhando:
            return
        try:
            if self.resultado.get('origem'):
                arquivo = Path(self.resultado['origem'])
            elif self.opcoes_anteriores and self.opcoes_anteriores.arquivo:
                arquivo = self.opcoes_anteriores.arquivo
            else:
                selecionado = filedialog.askopenfilename(parent=self.raiz, initialdir=str(ENTRADA), title='Selecione o PDF ORIGINAL correspondente à revisão', filetypes=[('PDF', '*.pdf')])
                if not selecionado:
                    return
                arquivo = Path(selecionado)
            prompt = self.resultado.get('prompt')
            if not prompt or not Path(prompt).is_file():
                prompt = filedialog.askopenfilename(parent=self.raiz, initialdir=str(ENTRADA / 'barco'),
                                                    title='Selecione o prompt gerado junto ao PDF', filetypes=[('Prompt', '*.md')])
            if not prompt:
                return
            resposta = filedialog.askopenfilename(parent=self.raiz, initialdir=str(Path(prompt).parent), title='Selecione a resposta JSON preenchida pelo Codex', filetypes=[('Revisão JSON', '*.json')])
            if resposta:
                self.iniciar(Opcoes(arquivo=arquivo, modo='importar', resposta=Path(resposta), prompt=Path(prompt), destino=Path(prompt).parent))
        except Exception as erro:
            messagebox.showerror('Importação', str(erro), parent=self.raiz)

    def instalar_dependencias(self) -> None:
        """Mostra a instalação em andamento sem bloquear a janela."""
        if self.trabalhando:
            return
        self.resultado = {}
        self.preparar_progresso('Instalando dependências', 'Bibliotecas Python e navegador Chromium')
        self.etapa.set('Instalando bibliotecas e navegador…')
        self.percentual.set('Em curso')
        self.barra.configure(mode='indeterminate')
        self.barra.start(15)
        self.trabalhando = True

        def trabalho() -> None:
            """Instala usando o Python que abriu esta janela."""
            try:
                instalar(lambda m: self.fila.put(('instalacao_log', m)))
                self.fila.put(('instalado',))
            except Exception as erro:
                self.fila.put(('erro', str(erro), ''))

        threading.Thread(target=trabalho, daemon=True).start()

    def pedir_cancelamento(self) -> None:
        """Solicita parada após a operação de rede em andamento."""
        self.cancelar.set()
        self.etapa.set('Cancelando após a operação em andamento…')
        self.estado_progresso.configure(text='Cancelando', style='Aviso.TLabel')
        self.botao_parar.configure(state='disabled')

    def abrir_resultado(self, chave: str) -> None:
        """Abre PDF ou pacote produzido, quando disponível."""
        from tkinter import messagebox
        try:
            abrir(Path(self.resultado[chave]))
        except Exception as erro:
            messagebox.showerror('Abrir arquivo', str(erro), parent=self.raiz)

    def copiar_prompt(self) -> None:
        """Entrega as instruções completas para colar no Codex já aberto no VS Code."""
        from tkinter import messagebox
        try:
            texto = Path(self.resultado['prompt']).read_text(encoding='utf-8')
            self.raiz.clipboard_clear()
            self.raiz.clipboard_append(texto)
            self.etapa.set('Prompt copiado. Cole no Codex do VS Code e peça para executar as instruções.')
        except (KeyError, OSError) as erro:
            messagebox.showerror('Copiar prompt', str(erro), parent=self.raiz)

    def voltar(self) -> None:
        """Restaura a seleção somente depois que a thread terminou."""
        if not self.trabalhando:
            self.progresso.pack_forget()
            self.selecao.pack(fill='both', expand=True)

    def fechar(self) -> None:
        """Mantém a janela aberta até o cancelamento concluir, preservando arquivos."""
        if self.trabalhando:
            self.pedir_cancelamento()
            return
        for chamada in (self._atualizacao, self._ajuste_cartoes):
            if chamada:
                self.raiz.after_cancel(chamada)
        self.raiz.destroy()


def principal() -> int:
    """Sem argumentos abre a página HTML local; parâmetros permitem uso pelo terminal."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arquivo', type=Path)
    parser.add_argument('--modo', choices=['codex', 'pacote', 'importar'], default='codex')
    parser.add_argument('--resposta', type=Path)
    parser.add_argument('--prompt', type=Path)
    parser.add_argument('--sem-capturas', action='store_true')
    parser.add_argument('--destino', type=Path, default=ENTRADA / 'barco')
    parser.add_argument('--execucoes', type=Path, default=PASTA / 'execucoes')
    parser.add_argument('--instalar', action='store_true')
    parser.add_argument('--verificar-ambiente', action='store_true')
    args = parser.parse_args()
    if args.instalar:
        instalar()
        return 0
    if args.verificar_ambiente:
        ausentes = dependencias_ausentes()
        print('Dependências ausentes: ' + ', '.join(ausentes) if ausentes else 'Bibliotecas disponíveis.')
        return int(bool(ausentes))
    if args.arquivo:
        opcoes = Opcoes(arquivo=args.arquivo, modo=args.modo, resposta=args.resposta, prompt=args.prompt,
                        capturar=not args.sem_capturas, destino=args.destino, execucoes=args.execucoes)
        try:
            resultado = Processo(opcoes, lambda p, m: print(f'{p:.0f}% {m}', flush=True)).executar()
            print(resultado['arquivo'])
            if resultado.get('prompt'):
                print('Prompt para o Codex: ' + resultado['prompt'])
            return 0
        except (Exception, KeyboardInterrupt) as erro:
            print(str(erro), file=sys.stderr)
            return 1
    from web_local import principal as abrir_pagina
    return abrir_pagina([])


if __name__ == '__main__':
    raise SystemExit(principal())
