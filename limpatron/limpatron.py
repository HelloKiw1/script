import hashlib
import re
from collections import defaultdict
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


def get_file_hash(path, chunk_size=65536):
    """Gera um hash SHA256 de forma eficiente em memória."""
    hasher = hashlib.sha256()
    with path.open("rb") as file_handle:
        while chunk := file_handle.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()


def format_size(size_in_bytes):
    size = float(size_in_bytes)
    units = ["B", "KB", "MB", "GB", "TB"]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.2f} {unit}"
        size /= 1024


def normalize_file_name(file_path):
    stem = re.sub(r"\(\d+\)$", "", file_path.stem)
    return f"{stem}{file_path.suffix.lower()}"


def duplicate_sort_key(file_path):
    has_copy_suffix = bool(re.search(r"\(\d+\)$", file_path.stem))
    return (has_copy_suffix, str(file_path).lower())


def find_duplicate_groups(target_dir):
    target_path = Path(target_dir)
    if not target_path.is_dir():
        raise ValueError("O caminho informado não é uma pasta válida.")

    potential_duplicates = defaultdict(list)
    for file_path in target_path.rglob("*"):
        if file_path.is_file():
            stats = file_path.stat()
            key = (normalize_file_name(file_path), stats.st_size)
            potential_duplicates[key].append(file_path)

    duplicate_groups = []
    for (_, size), paths in potential_duplicates.items():
        if len(paths) < 2:
            continue

        hashed_groups = defaultdict(list)
        for path in sorted(paths, key=duplicate_sort_key):
            hashed_groups[get_file_hash(path)].append(path)

        for same_content_paths in hashed_groups.values():
            if len(same_content_paths) < 2:
                continue

            duplicate_groups.append(
                {
                    "keeper": same_content_paths[0],
                    "duplicates": same_content_paths[1:],
                    "size": size,
                }
            )

    duplicate_groups.sort(key=lambda group: str(group["keeper"]).lower())
    return duplicate_groups


def remove_duplicates(duplicate_groups):
    files_removed = 0
    space_saved = 0

    for group in duplicate_groups:
        for duplicate_path in group["duplicates"]:
            duplicate_path.unlink()
            files_removed += 1
            space_saved += group["size"]

    return files_removed, space_saved


class LimpatronApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Limpatron")
        self.geometry("920x600")
        self.minsize(760, 480)

        self.selected_folder = tk.StringVar()
        self.summary_text = tk.StringVar(
            value="Selecione uma pasta para procurar documentos duplicados."
        )
        self.duplicate_groups = []

        self._build_interface()

    def _build_interface(self):
        main_frame = ttk.Frame(self, padding=16)
        main_frame.pack(fill="both", expand=True)

        header_label = ttk.Label(
            main_frame,
            text="Selecionar pasta com documentos duplicados",
            font=("Segoe UI", 12, "bold"),
        )
        header_label.pack(anchor="w")

        description_label = ttk.Label(
            main_frame,
            text=(
                "O app mostra quais arquivos vão permanecer e quais duplicados serão excluídos."
            ),
            wraplength=860,
        )
        description_label.pack(anchor="w", pady=(6, 12))

        folder_frame = ttk.Frame(main_frame)
        folder_frame.pack(fill="x")

        folder_entry = ttk.Entry(
            folder_frame,
            textvariable=self.selected_folder,
            state="readonly",
        )
        folder_entry.pack(side="left", fill="x", expand=True)

        browse_button = ttk.Button(
            folder_frame,
            text="Escolher pasta",
            command=self.select_folder,
        )
        browse_button.pack(side="left", padx=(8, 0))

        actions_frame = ttk.Frame(main_frame)
        actions_frame.pack(fill="x", pady=(12, 12))

        scan_button = ttk.Button(
            actions_frame,
            text="Analisar duplicados",
            command=self.scan_duplicates,
        )
        scan_button.pack(side="left")

        self.confirm_button = ttk.Button(
            actions_frame,
            text="Confirmar exclusão",
            command=self.confirm_removal,
            state="disabled",
        )
        self.confirm_button.pack(side="left", padx=(8, 0))

        summary_label = ttk.Label(
            main_frame,
            textvariable=self.summary_text,
            wraplength=860,
            justify="left",
        )
        summary_label.pack(anchor="w", pady=(0, 12))

        list_frame = ttk.Frame(main_frame)
        list_frame.pack(fill="both", expand=True)

        columns = ("status", "caminho")
        self.tree = ttk.Treeview(
            list_frame,
            columns=columns,
            show="tree headings",
            height=20,
        )
        self.tree.heading("#0", text="Nome")
        self.tree.heading("status", text="Status")
        self.tree.heading("caminho", text="Caminho completo")

        self.tree.column("#0", width=260, anchor="w", stretch=False)
        self.tree.column("status", width=160, anchor="w", stretch=False)
        self.tree.column("caminho", width=480, anchor="w")

        scrollbar = ttk.Scrollbar(
            list_frame,
            orient="vertical",
            command=self.tree.yview,
        )
        self.tree.configure(yscrollcommand=scrollbar.set)

        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def select_folder(self):
        chosen_folder = filedialog.askdirectory(
            title="Selecione a pasta com os documentos duplicados"
        )
        if chosen_folder:
            self.selected_folder.set(chosen_folder)

    def scan_duplicates(self):
        folder = self.selected_folder.get().strip()
        if not folder:
            messagebox.showwarning("Pasta não selecionada", "Escolha uma pasta primeiro.")
            return

        try:
            duplicate_groups = find_duplicate_groups(folder)
        except (OSError, ValueError) as error:
            messagebox.showerror("Erro ao analisar", str(error))
            return

        self.duplicate_groups = duplicate_groups
        self.populate_tree()

        duplicates_count = sum(len(group["duplicates"]) for group in duplicate_groups)
        total_size = sum(group["size"] * len(group["duplicates"]) for group in duplicate_groups)

        if duplicates_count == 0:
            self.summary_text.set("Nenhum documento duplicado foi encontrado na pasta selecionada.")
            self.confirm_button.config(state="disabled")
            return

        self.summary_text.set(
            "Revise a lista abaixo antes de excluir. "
            f"{len(duplicate_groups)} grupo(s) encontrado(s), "
            f"{duplicates_count} arquivo(s) duplicado(s) serão removido(s) "
            f"e {format_size(total_size)} serão liberados."
        )
        self.confirm_button.config(state="normal")

    def populate_tree(self):
        self.tree.delete(*self.tree.get_children())

        for group in self.duplicate_groups:
            keeper = group["keeper"]
            keeper_item = self.tree.insert(
                "",
                "end",
                text=keeper.name,
                values=("Vai permanecer", str(keeper)),
                open=True,
            )

            for duplicate_path in group["duplicates"]:
                self.tree.insert(
                    keeper_item,
                    "end",
                    text=duplicate_path.name,
                    values=("Duplicado", str(duplicate_path)),
                )

    def confirm_removal(self):
        if not self.duplicate_groups:
            messagebox.showwarning(
                "Nada para excluir",
                "Analise uma pasta com duplicados antes de confirmar a exclusão.",
            )
            return

        try:
            files_removed, space_saved = remove_duplicates(self.duplicate_groups)
        except OSError as error:
            messagebox.showerror("Erro ao excluir", str(error))
            return

        self.summary_text.set(
            f"Exclusão concluída. {files_removed} arquivo(s) removido(s) "
            f"e {format_size(space_saved)} liberados."
        )
        self.duplicate_groups = []
        self.confirm_button.config(state="disabled")
        self.tree.delete(*self.tree.get_children())
        messagebox.showinfo("Concluído", "Os documentos duplicados foram excluídos.")


def main():
    app = LimpatronApp()
    app.mainloop()


if __name__ == "__main__":
    main()
