"""Abre a janela do Relatório Barco ou executa um processamento pelo terminal."""
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
        self.raiz.title('Barco Digital | Relatórios PNTP 2026')
        altura = min(790, self.raiz.winfo_screenheight() - 70)
        self.raiz.geometry(f'1040x{max(640, altura)}')
        self.raiz.minsize(900, 640)
        self.raiz.configure(bg='#eef4fc')
        estilo = ttk.Style()
        estilo.theme_use('clam')
        estilo.configure('.', font=('Segoe UI', 10), background='#ffffff', foreground='#172033')
        estilo.configure('TFrame', background='#ffffff')
        estilo.configure('TLabel', background='#ffffff')
        estilo.configure('TButton', padding=(14, 9))
        estilo.configure('Azul.TButton', foreground='white', background='#0b62c4', borderwidth=0, padding=(18, 11))
        estilo.map('Azul.TButton', background=[('active', '#084a97'), ('disabled', '#91aac5')])
        estilo.configure('Titulo.TLabel', font=('Segoe UI Semibold', 18), foreground='#082f63')
        estilo.configure('Subtitulo.TLabel', foreground='#5c6f85')
        estilo.configure('TProgressbar', background='#0b62c4', troughcolor='#e4edf8', borderwidth=0)
        cabecalho = tk.Frame(raiz, bg='#082f63', padx=28, pady=20)
        cabecalho.pack(fill='x')
        logo = ATRICON / 'assets/logo-da-empresa.png'
        self.logo = None
        if logo.exists():
            try:
                self.logo = tk.PhotoImage(file=str(logo))
                fator = max(1, max(self.logo.width(), self.logo.height()) // 60)
                self.logo = self.logo.subsample(fator)
                tk.Label(cabecalho, image=self.logo, bg='#082f63').pack(side='left', padx=(0, 16))
            except tk.TclError:
                pass
        tk.Label(cabecalho, text='Relatórios Barco Digital', bg='#082f63', fg='white', font=('Segoe UI Semibold', 22)).pack(anchor='w')
        tk.Label(cabecalho, text='PDF original → evidências atuais → revisão dos textos → relatório', bg='#082f63', fg='#cfdef3', font=('Segoe UI', 10)).pack(anchor='w', pady=(5, 0))
        self.corpo = ttk.Frame(raiz, padding=26)
        self.corpo.pack(fill='both', expand=True, padx=22, pady=20)
        self.selecao = ttk.Frame(self.corpo)
        self.selecao.pack(fill='both', expand=True)
        self.rodape = ttk.Frame(self.selecao, padding=(0, 12, 0, 0))
        self.rodape.pack(side='bottom', fill='x')
        self.rolagem = tk.Canvas(self.selecao, background='white', highlightthickness=0)
        barra_vertical = ttk.Scrollbar(self.selecao, orient='vertical', command=self.rolagem.yview)
        barra_vertical.pack(side='right', fill='y')
        self.rolagem.configure(yscrollcommand=barra_vertical.set)
        self.rolagem.pack(side='left', fill='both', expand=True)
        self.formulario = ttk.Frame(self.rolagem)
        janela_formulario = self.rolagem.create_window((0, 0), window=self.formulario, anchor='nw')
        self.formulario.bind('<Configure>', lambda evento: self.rolagem.configure(scrollregion=self.rolagem.bbox('all')))
        self.rolagem.bind('<Configure>', lambda evento: self.rolagem.itemconfigure(janela_formulario, width=evento.width))
        self.montar_selecao()
        self.progresso = ttk.Frame(self.corpo)
        self.montar_progresso()
        self.raiz.protocol('WM_DELETE_WINDOW', self.fechar)
        self.raiz.after(150, self.atualizar)

    def montar_selecao(self) -> None:
        """Oferece PDF local ou órgão do cadastro, com revisão manual/API opcional."""
        from tkinter import ttk
        tk = self.tk
        ttk.Label(self.formulario, text='Escolha o relatório de entrada', style='Titulo.TLabel').pack(anchor='w')
        ttk.Label(self.formulario, text='Os PDFs concluídos em analise_2026/barco permanecem como referência.', style='Subtitulo.TLabel').pack(anchor='w', pady=(4, 16))
        self.origem = tk.StringVar(value='pdf')
        self.arquivo = tk.StringVar()
        self.cadastro = tk.StringVar(value=str(ATRICON / 'entrada/orgaos_avalia.json'))
        self.orgao = tk.StringVar()
        linha = ttk.Frame(self.formulario)
        linha.pack(fill='x')
        ttk.Radiobutton(linha, text='Selecionar PDF original', variable=self.origem, value='pdf').pack(side='left')
        ttk.Radiobutton(linha, text='Buscar pelo órgão no Avalia', variable=self.origem, value='orgao').pack(side='left', padx=22)
        linha = ttk.Frame(self.formulario)
        linha.pack(fill='x', pady=(12, 8))
        ttk.Entry(linha, textvariable=self.arquivo).pack(side='left', fill='x', expand=True)
        ttk.Button(linha, text='Escolher PDF…', command=self.escolher_pdf).pack(side='left', padx=(10, 0))
        linha = ttk.Frame(self.formulario)
        linha.pack(fill='x', pady=(0, 10))
        self.combo = ttk.Combobox(linha, textvariable=self.orgao)
        self.combo.pack(side='left', fill='x', expand=True)
        self.combo.bind('<KeyRelease>', self.filtrar_orgaos)
        self.combo.bind('<<ComboboxSelected>>', lambda evento: self.origem.set('orgao'))
        ttk.Button(linha, text='Cadastro…', command=self.escolher_cadastro).pack(side='left', padx=(10, 0))
        self.carregar_orgaos()
        ttk.Separator(self.formulario).pack(fill='x', pady=12)
        ttk.Label(self.formulario, text='Como revisar os comentários', font=('Segoe UI Semibold', 12)).pack(anchor='w')
        self.modo = tk.StringVar(value='pacote')
        ttk.Radiobutton(self.formulario, text='Preparar PDF e pacote para revisar em outra IA (sem chamada paga)', variable=self.modo, value='pacote').pack(anchor='w', pady=(10, 4))
        ttk.Radiobutton(self.formulario, text='Revisar automaticamente com IA depois de acumular as evidências', variable=self.modo, value='ia').pack(anchor='w', pady=3)
        linha = ttk.Frame(self.formulario)
        linha.pack(fill='x', pady=(4, 8))
        ttk.Label(linha, text='Modelo com visão:').pack(side='left')
        self.modelo = tk.StringVar(value=os.environ.get('OPENAI_MODEL', ''))
        ttk.Entry(linha, textvariable=self.modelo, width=27).pack(side='left', padx=10)
        ttk.Label(linha, text='Usa OPENAI_API_KEY do computador.', style='Subtitulo.TLabel').pack(side='left')
        self.reutilizar = tk.BooleanVar(value=False)
        self.visivel = tk.BooleanVar(value=False)
        ttk.Checkbutton(self.formulario, text='Reaproveitar capturas anteriores, mantendo a data original', variable=self.reutilizar).pack(anchor='w', pady=4)
        ttk.Checkbutton(self.formulario, text='Mostrar navegador durante a coleta', variable=self.visivel).pack(anchor='w', pady=4)
        avancado = ttk.Frame(self.formulario)
        avancado.pack(fill='x', pady=(10, 6))
        ttk.Label(avancado, text='Espera por componentes (s):').pack(side='left')
        self.espera = tk.IntVar(value=25)
        ttk.Spinbox(avancado, from_=5, to=90, textvariable=self.espera, width=4).pack(side='left', padx=8)
        ttk.Label(avancado, text='Documentos por página:').pack(side='left', padx=(15, 0))
        self.documentos = tk.IntVar(value=3)
        ttk.Spinbox(avancado, from_=0, to=10, textvariable=self.documentos, width=4).pack(side='left', padx=8)
        ttk.Label(self.formulario, text='A captura abre páginas e controles de consulta. Limitações ficam registradas no pacote.\nSem revisão concluída, a saída recebe o sufixo _rascunho e não substitui os exemplos.', style='Subtitulo.TLabel', wraplength=890).pack(anchor='w', pady=(8, 14))
        acoes = self.rodape
        ttk.Button(acoes, text='Gerar relatório', style='Azul.TButton', command=self.iniciar).pack(side='right')
        ttk.Button(acoes, text='Instalar dependências', command=self.instalar_dependencias).pack(side='left')
        ttk.Button(acoes, text='Importar revisão…', command=self.importar).pack(side='left', padx=8)

    def montar_progresso(self) -> None:
        """Prepara a tela de etapas, porcentagem e histórico do processamento."""
        ttk = self.ttk
        self.etapa = self.tk.StringVar(value='Preparando')
        self.percentual = self.tk.StringVar(value='0%')
        ttk.Label(self.progresso, text='Preparando o relatório', style='Titulo.TLabel').pack(anchor='w')
        self.entidade_progresso = ttk.Label(self.progresso, text='', style='Subtitulo.TLabel')
        self.entidade_progresso.pack(anchor='w', pady=(6, 26))
        ttk.Label(self.progresso, textvariable=self.etapa, font=('Segoe UI Semibold', 13), wraplength=880).pack(anchor='w', pady=(0, 16))
        self.barra = ttk.Progressbar(self.progresso, maximum=100, mode='determinate')
        self.barra.pack(fill='x')
        ttk.Label(self.progresso, textvariable=self.percentual, style='Subtitulo.TLabel').pack(anchor='e', pady=6)
        ttk.Label(self.progresso, text='Progresso por etapas; páginas e documentos podem ter tempos diferentes.', style='Subtitulo.TLabel').pack(anchor='w')
        self.log = self.tk.Text(self.progresso, height=14, font=('Consolas', 10), bg='#f4f7fb', fg='#334760', relief='flat', padx=12, pady=12, wrap='word', state='disabled')
        self.log.pack(fill='both', expand=True, pady=18)
        acoes = ttk.Frame(self.progresso)
        acoes.pack(fill='x')
        self.botao_parar = ttk.Button(acoes, text='Cancelar', command=self.pedir_cancelamento)
        self.botao_parar.pack(side='left')
        self.botao_pdf = ttk.Button(acoes, text='Abrir PDF', command=lambda: self.abrir_resultado('arquivo'), state='disabled')
        self.botao_pdf.pack(side='right')
        self.botao_pacote = ttk.Button(acoes, text='Abrir pacote', command=lambda: self.abrir_resultado('pacote'), state='disabled')
        self.botao_pacote.pack(side='right', padx=8)
        self.botao_importar = ttk.Button(acoes, text='Importar revisão…', command=self.importar, state='disabled')
        self.botao_importar.pack(side='right')
        self.botao_voltar = ttk.Button(acoes, text='Outro órgão', command=self.voltar, state='disabled')
        self.botao_voltar.pack(side='left', padx=8)

    def carregar_orgaos(self) -> None:
        """Carrega rótulos públicos e mantém um erro de cadastro fora do fluxo de PDF local."""
        try:
            self.orgaos = listar_orgaos(Path(self.cadastro.get()))
        except Exception:
            self.orgaos = []
        self.combo['values'] = [o['rotulo'] for o in self.orgaos]

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
        opcoes = Opcoes(modo=self.modo.get(), modelo=self.modelo.get().strip(), cadastro=Path(self.cadastro.get()),
                        reutilizar=self.reutilizar.get(), navegador_visivel=self.visivel.get(),
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
        if opcoes.modo == 'ia' and (not opcoes.modelo or not os.environ.get('OPENAI_API_KEY')):
            raise ValueError('Informe o modelo com visão e configure OPENAI_API_KEY. O modo pacote funciona sem API.')
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
        self.selecao.pack_forget()
        self.progresso.pack(fill='both', expand=True)
        self.entidade_progresso.configure(text=str(opcoes.arquivo or self.orgao.get()))
        self.botao_parar.configure(state='normal')
        for botao in (self.botao_pdf, self.botao_pacote, self.botao_importar, self.botao_voltar):
            botao.configure(state='disabled')
        self.barra['value'] = 0
        self.percentual.set('0%')
        self.log.configure(state='normal')
        self.log.delete('1.0', 'end')
        self.log.configure(state='disabled')
        threading.Thread(target=self.executar, args=(opcoes,), daemon=True).start()

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
                    self.botao_parar.configure(state='disabled')
                    self.botao_voltar.configure(state='normal')
                    if item[0] == 'concluido':
                        self.resultado = item[1]
                        self.botao_pdf.configure(state='normal')
                        self.botao_pacote.configure(state='normal')
                        self.botao_importar.configure(state='normal')
                        self.registrar(f'{item[1]["paginas"]} páginas. Saída: {item[1]["arquivo"]}')
                        self.registrar(f'Pacote de revisão: {item[1]["pacote"]}')
                        if item[1]['pendencias']:
                            self.registrar(f'{len(item[1]["pendencias"])} pendências registradas em pendencias.json. O PDF está identificado como rascunho.')
                    elif item[0] == 'instalado':
                        self.etapa.set('Instalação concluída. Feche e abra novamente o programa.')
                        self.barra['value'] = 100
                        self.percentual.set('100%')
                    else:
                        self.etapa.set('Processamento interrompido')
                        self.registrar(item[1])
                        if item[2]:
                            self.resultado = {'pacote': item[2]}
                            self.botao_pacote.configure(state='normal')
        except queue.Empty:
            pass
        self.raiz.after(150, self.atualizar)

    def importar(self) -> None:
        """Importa uma revisão e regenera sem repetir a coleta existente."""
        from tkinter import filedialog, messagebox
        if self.trabalhando:
            return
        try:
            if self.opcoes_anteriores and self.opcoes_anteriores.arquivo:
                arquivo = self.opcoes_anteriores.arquivo
            else:
                selecionado = filedialog.askopenfilename(parent=self.raiz, initialdir=str(ENTRADA), title='Selecione o PDF ORIGINAL correspondente à revisão', filetypes=[('PDF', '*.pdf')])
                if not selecionado:
                    return
                arquivo = Path(selecionado)
            resposta = filedialog.askopenfilename(parent=self.raiz, initialdir=self.resultado.get('pacote', str(PASTA / 'execucoes')), title='Selecione resposta_ia.json', filetypes=[('Revisão JSON', '*.json')])
            if resposta:
                self.iniciar(Opcoes(arquivo=arquivo, modo='importar', resposta=Path(resposta), reutilizar=True))
        except Exception as erro:
            messagebox.showerror('Importação', str(erro), parent=self.raiz)

    def instalar_dependencias(self) -> None:
        """Mostra a instalação em andamento sem bloquear a janela."""
        if self.trabalhando:
            return
        self.selecao.pack_forget()
        self.progresso.pack(fill='both', expand=True)
        self.etapa.set('Instalando bibliotecas e navegador')
        self.trabalhando = True
        self.botao_parar.configure(state='disabled')

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
        self.botao_parar.configure(state='disabled')

    def abrir_resultado(self, chave: str) -> None:
        """Abre PDF ou pacote produzido, quando disponível."""
        from tkinter import messagebox
        try:
            abrir(Path(self.resultado[chave]))
        except Exception as erro:
            messagebox.showerror('Abrir arquivo', str(erro), parent=self.raiz)

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
        self.raiz.destroy()


def principal() -> int:
    """Sem argumentos abre a janela; parâmetros permitem integração e testes locais."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arquivo', type=Path)
    parser.add_argument('--modo', choices=['pacote', 'ia', 'importar'], default='pacote')
    parser.add_argument('--modelo', default=os.environ.get('OPENAI_MODEL', ''))
    parser.add_argument('--resposta', type=Path)
    parser.add_argument('--reutilizar', action='store_true')
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
        opcoes = Opcoes(arquivo=args.arquivo, modo=args.modo, modelo=args.modelo, resposta=args.resposta,
                        reutilizar=args.reutilizar, capturar=not args.sem_capturas, destino=args.destino, execucoes=args.execucoes)
        try:
            resultado = Processo(opcoes, lambda p, m: print(f'{p:.0f}% {m}', flush=True)).executar()
            print(resultado['arquivo'])
            return 0
        except (Exception, KeyboardInterrupt) as erro:
            print(str(erro), file=sys.stderr)
            return 1
    import tkinter as tk
    raiz = tk.Tk()
    Janela(raiz)
    raiz.mainloop()
    return 0


if __name__ == '__main__':
    raise SystemExit(principal())
