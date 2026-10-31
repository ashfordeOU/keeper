// SPDX-License-Identifier: AGPL-3.0-or-later
// The Terminal's own words, in every language Keeper speaks (pure data, no React).

type Dict = Record<string, string>;

const en: Dict = {
  title: 'Terminal', newTab: 'New tab', newTerminal: 'New terminal', splitRight: 'Split right', splitDown: 'Split down', close: 'Close', closePane: 'Close pane',
  zoom: 'Zoom pane', broadcast: 'Type in every pane', broadcastOn: 'Typing goes to every pane in this tab', profiles: 'Profiles', shells: 'Shells', sshHosts: 'SSH hosts',
  webTools: 'Web tools', editor: 'Code editor', notebook: 'Notebooks', webPage: 'Web page on this computer', files: 'Files', notes: 'Notes', sessions: 'Sessions',
  settings: 'Terminal settings', keybindings: 'Keyboard shortcuts', triggers: 'Triggers', workspaces: 'Workspaces', saveWorkspace: 'Save this layout…',
  detach: 'Keep running in the background', restart: 'Start again here', restored: 'Restored from last time — nothing is running.', exited: 'The program ended',
  search: 'Find in scrollback', clear: 'Clear', rename: 'Rename', clone: 'Sister terminal (same folder)', mirror: 'Show in another pane', group: 'Group',
  openIn: 'Open folder in…', isolate: 'Keep this profile’s sign-ins separate', isolateHome: 'Also give it its own home folder', locale: 'Language for programs',
  keepAlive: 'When Keeper’s windows close', keepWindow: 'Keep terminals until Keeper quits', keepQuit: 'Keep terminals running even after Keeper quits', keepNever: 'End terminals when their window closes',
  pasteGuard: 'Ask before pasting several lines', confirmBroadcast: 'Ask before typing into several panes', copyOnSelect: 'Copy when selecting', quick: 'Drop-down terminal',
  pasteTitle: 'Paste several lines?', pasteBody: 'Each line may run as a command.', paste: 'Paste', cancel: 'Cancel', running: 'running', empty: 'No terminals yet',
  connect: 'Connect', password: 'Password', upload: 'Upload…', download: 'Download', newFolder: 'New folder', delete: 'Delete', up: 'Up',
  shared: 'Shared with every terminal in the group (programs can read it at $KEEPER_SHARED_DIR/notes.md)', tabNotes: 'Notes for this tab',
  missing: 'Not installed', start: 'Start', url: 'Address', open: 'Open', save: 'Save', name: 'Name', default: 'Default',
};

const es: Dict = {
  title: 'Terminal', newTab: 'Pestaña nueva', newTerminal: 'Terminal nuevo', splitRight: 'Dividir a la derecha', splitDown: 'Dividir hacia abajo', close: 'Cerrar', closePane: 'Cerrar panel',
  zoom: 'Ampliar panel', broadcast: 'Escribir en todos los paneles', broadcastOn: 'Lo que escribas va a todos los paneles de esta pestaña', profiles: 'Perfiles', shells: 'Shells', sshHosts: 'Servidores SSH',
  webTools: 'Herramientas web', editor: 'Editor de código', notebook: 'Cuadernos', webPage: 'Página web en este equipo', files: 'Archivos', notes: 'Notas', sessions: 'Sesiones',
  settings: 'Ajustes del terminal', keybindings: 'Atajos de teclado', triggers: 'Disparadores', workspaces: 'Espacios de trabajo', saveWorkspace: 'Guardar esta disposición…',
  detach: 'Seguir en segundo plano', restart: 'Empezar de nuevo aquí', restored: 'Restaurado de la última vez: no hay nada en marcha.', exited: 'El programa terminó',
  search: 'Buscar en el historial', clear: 'Limpiar', rename: 'Renombrar', clone: 'Terminal hermano (misma carpeta)', mirror: 'Mostrar en otro panel', group: 'Grupo',
  openIn: 'Abrir carpeta en…', isolate: 'Mantener separados los inicios de sesión de este perfil', isolateHome: 'Darle también su propia carpeta personal', locale: 'Idioma de los programas',
  keepAlive: 'Al cerrar las ventanas de Keeper', keepWindow: 'Mantener los terminales hasta salir de Keeper', keepQuit: 'Mantenerlos incluso después de salir de Keeper', keepNever: 'Cerrarlos al cerrar su ventana',
  pasteGuard: 'Preguntar antes de pegar varias líneas', confirmBroadcast: 'Preguntar antes de escribir en varios paneles', copyOnSelect: 'Copiar al seleccionar', quick: 'Terminal desplegable',
  pasteTitle: '¿Pegar varias líneas?', pasteBody: 'Cada línea puede ejecutarse como un comando.', paste: 'Pegar', cancel: 'Cancelar', running: 'en marcha', empty: 'Aún no hay terminales',
  connect: 'Conectar', password: 'Contraseña', upload: 'Subir…', download: 'Descargar', newFolder: 'Carpeta nueva', delete: 'Eliminar', up: 'Subir nivel',
  shared: 'Compartido con todos los terminales del grupo (los programas pueden leerlo en $KEEPER_SHARED_DIR/notes.md)', tabNotes: 'Notas de esta pestaña',
  missing: 'No instalado', start: 'Iniciar', url: 'Dirección', open: 'Abrir', save: 'Guardar', name: 'Nombre', default: 'Predeterminado',
};

const de: Dict = {
  title: 'Terminal', newTab: 'Neuer Tab', newTerminal: 'Neues Terminal', splitRight: 'Rechts teilen', splitDown: 'Unten teilen', close: 'Schließen', closePane: 'Bereich schließen',
  zoom: 'Bereich vergrößern', broadcast: 'In alle Bereiche tippen', broadcastOn: 'Eingaben gehen an alle Bereiche dieses Tabs', profiles: 'Profile', shells: 'Shells', sshHosts: 'SSH-Server',
  webTools: 'Web-Werkzeuge', editor: 'Code-Editor', notebook: 'Notebooks', webPage: 'Webseite auf diesem Computer', files: 'Dateien', notes: 'Notizen', sessions: 'Sitzungen',
  settings: 'Terminal-Einstellungen', keybindings: 'Tastenkürzel', triggers: 'Auslöser', workspaces: 'Arbeitsbereiche', saveWorkspace: 'Dieses Layout sichern…',
  detach: 'Im Hintergrund weiterlaufen lassen', restart: 'Hier neu starten', restored: 'Vom letzten Mal wiederhergestellt – es läuft nichts.', exited: 'Das Programm wurde beendet',
  search: 'Im Verlauf suchen', clear: 'Leeren', rename: 'Umbenennen', clone: 'Geschwister-Terminal (gleicher Ordner)', mirror: 'In anderem Bereich zeigen', group: 'Gruppe',
  openIn: 'Ordner öffnen in…', isolate: 'Anmeldungen dieses Profils getrennt halten', isolateHome: 'Auch einen eigenen Benutzerordner geben', locale: 'Sprache für Programme',
  keepAlive: 'Wenn Keepers Fenster schließen', keepWindow: 'Terminals bis zum Beenden von Keeper behalten', keepQuit: 'Terminals auch nach dem Beenden weiterlaufen lassen', keepNever: 'Terminals mit ihrem Fenster beenden',
  pasteGuard: 'Vor dem Einfügen mehrerer Zeilen fragen', confirmBroadcast: 'Vor dem Tippen in mehrere Bereiche fragen', copyOnSelect: 'Beim Markieren kopieren', quick: 'Ausklapp-Terminal',
  pasteTitle: 'Mehrere Zeilen einfügen?', pasteBody: 'Jede Zeile kann als Befehl ausgeführt werden.', paste: 'Einfügen', cancel: 'Abbrechen', running: 'läuft', empty: 'Noch keine Terminals',
  connect: 'Verbinden', password: 'Passwort', upload: 'Hochladen…', download: 'Herunterladen', newFolder: 'Neuer Ordner', delete: 'Löschen', up: 'Nach oben',
  shared: 'Mit allen Terminals der Gruppe geteilt (Programme lesen es unter $KEEPER_SHARED_DIR/notes.md)', tabNotes: 'Notizen zu diesem Tab',
  missing: 'Nicht installiert', start: 'Starten', url: 'Adresse', open: 'Öffnen', save: 'Sichern', name: 'Name', default: 'Standard',
};

const fr: Dict = {
  title: 'Terminal', newTab: 'Nouvel onglet', newTerminal: 'Nouveau terminal', splitRight: 'Diviser à droite', splitDown: 'Diviser en bas', close: 'Fermer', closePane: 'Fermer le panneau',
  zoom: 'Agrandir le panneau', broadcast: 'Écrire dans tous les panneaux', broadcastOn: 'La saisie va à tous les panneaux de cet onglet', profiles: 'Profils', shells: 'Shells', sshHosts: 'Serveurs SSH',
  webTools: 'Outils web', editor: 'Éditeur de code', notebook: 'Notebooks', webPage: 'Page web sur cet ordinateur', files: 'Fichiers', notes: 'Notes', sessions: 'Sessions',
  settings: 'Réglages du terminal', keybindings: 'Raccourcis clavier', triggers: 'Déclencheurs', workspaces: 'Espaces de travail', saveWorkspace: 'Enregistrer cette disposition…',
  detach: 'Continuer en arrière-plan', restart: 'Recommencer ici', restored: 'Restauré depuis la dernière fois — rien ne tourne.', exited: 'Le programme s’est arrêté',
  search: 'Rechercher dans l’historique', clear: 'Effacer', rename: 'Renommer', clone: 'Terminal jumeau (même dossier)', mirror: 'Afficher dans un autre panneau', group: 'Groupe',
  openIn: 'Ouvrir le dossier dans…', isolate: 'Garder les connexions de ce profil à part', isolateHome: 'Lui donner aussi son propre dossier personnel', locale: 'Langue des programmes',
  keepAlive: 'Quand les fenêtres de Keeper se ferment', keepWindow: 'Garder les terminaux jusqu’à quitter Keeper', keepQuit: 'Les garder même après avoir quitté Keeper', keepNever: 'Les fermer avec leur fenêtre',
  pasteGuard: 'Demander avant de coller plusieurs lignes', confirmBroadcast: 'Demander avant d’écrire dans plusieurs panneaux', copyOnSelect: 'Copier à la sélection', quick: 'Terminal déroulant',
  pasteTitle: 'Coller plusieurs lignes ?', pasteBody: 'Chaque ligne peut s’exécuter comme une commande.', paste: 'Coller', cancel: 'Annuler', running: 'en cours', empty: 'Pas encore de terminal',
  connect: 'Se connecter', password: 'Mot de passe', upload: 'Envoyer…', download: 'Télécharger', newFolder: 'Nouveau dossier', delete: 'Supprimer', up: 'Remonter',
  shared: 'Partagé avec tous les terminaux du groupe (lisible par les programmes dans $KEEPER_SHARED_DIR/notes.md)', tabNotes: 'Notes de cet onglet',
  missing: 'Non installé', start: 'Démarrer', url: 'Adresse', open: 'Ouvrir', save: 'Enregistrer', name: 'Nom', default: 'Par défaut',
};

const ptBR: Dict = {
  title: 'Terminal', newTab: 'Nova aba', newTerminal: 'Novo terminal', splitRight: 'Dividir à direita', splitDown: 'Dividir abaixo', close: 'Fechar', closePane: 'Fechar painel',
  zoom: 'Ampliar painel', broadcast: 'Digitar em todos os painéis', broadcastOn: 'A digitação vai para todos os painéis desta aba', profiles: 'Perfis', shells: 'Shells', sshHosts: 'Servidores SSH',
  webTools: 'Ferramentas web', editor: 'Editor de código', notebook: 'Notebooks', webPage: 'Página web neste computador', files: 'Arquivos', notes: 'Notas', sessions: 'Sessões',
  settings: 'Ajustes do terminal', keybindings: 'Atalhos de teclado', triggers: 'Gatilhos', workspaces: 'Espaços de trabalho', saveWorkspace: 'Salvar este layout…',
  detach: 'Continuar em segundo plano', restart: 'Começar de novo aqui', restored: 'Restaurado da última vez — nada está rodando.', exited: 'O programa terminou',
  search: 'Buscar no histórico', clear: 'Limpar', rename: 'Renomear', clone: 'Terminal irmão (mesma pasta)', mirror: 'Mostrar em outro painel', group: 'Grupo',
  openIn: 'Abrir pasta em…', isolate: 'Manter os logins deste perfil separados', isolateHome: 'Dar também uma pasta pessoal própria', locale: 'Idioma dos programas',
  keepAlive: 'Quando as janelas do Keeper fecham', keepWindow: 'Manter terminais até sair do Keeper', keepQuit: 'Manter mesmo depois de sair do Keeper', keepNever: 'Encerrar junto com a janela',
  pasteGuard: 'Perguntar antes de colar várias linhas', confirmBroadcast: 'Perguntar antes de digitar em vários painéis', copyOnSelect: 'Copiar ao selecionar', quick: 'Terminal suspenso',
  pasteTitle: 'Colar várias linhas?', pasteBody: 'Cada linha pode rodar como um comando.', paste: 'Colar', cancel: 'Cancelar', running: 'rodando', empty: 'Ainda não há terminais',
  connect: 'Conectar', password: 'Senha', upload: 'Enviar…', download: 'Baixar', newFolder: 'Nova pasta', delete: 'Excluir', up: 'Subir',
  shared: 'Compartilhado com todos os terminais do grupo (programas leem em $KEEPER_SHARED_DIR/notes.md)', tabNotes: 'Notas desta aba',
  missing: 'Não instalado', start: 'Iniciar', url: 'Endereço', open: 'Abrir', save: 'Salvar', name: 'Nome', default: 'Padrão',
};

const it: Dict = {
  title: 'Terminale', newTab: 'Nuova scheda', newTerminal: 'Nuovo terminale', splitRight: 'Dividi a destra', splitDown: 'Dividi in basso', close: 'Chiudi', closePane: 'Chiudi riquadro',
  zoom: 'Ingrandisci riquadro', broadcast: 'Scrivi in tutti i riquadri', broadcastOn: 'Ciò che scrivi va in tutti i riquadri della scheda', profiles: 'Profili', shells: 'Shell', sshHosts: 'Server SSH',
  webTools: 'Strumenti web', editor: 'Editor di codice', notebook: 'Notebook', webPage: 'Pagina web su questo computer', files: 'File', notes: 'Note', sessions: 'Sessioni',
  settings: 'Impostazioni del terminale', keybindings: 'Scorciatoie da tastiera', triggers: 'Attivatori', workspaces: 'Spazi di lavoro', saveWorkspace: 'Salva questa disposizione…',
  detach: 'Continua in background', restart: 'Ricomincia qui', restored: 'Ripristinato dall’ultima volta: non è in esecuzione nulla.', exited: 'Il programma è terminato',
  search: 'Cerca nella cronologia', clear: 'Pulisci', rename: 'Rinomina', clone: 'Terminale gemello (stessa cartella)', mirror: 'Mostra in un altro riquadro', group: 'Gruppo',
  openIn: 'Apri cartella in…', isolate: 'Tieni separati gli accessi di questo profilo', isolateHome: 'Dagli anche una cartella home propria', locale: 'Lingua dei programmi',
  keepAlive: 'Quando le finestre di Keeper si chiudono', keepWindow: 'Tieni i terminali fino all’uscita da Keeper', keepQuit: 'Tienili attivi anche dopo l’uscita', keepNever: 'Chiudili con la loro finestra',
  pasteGuard: 'Chiedi prima di incollare più righe', confirmBroadcast: 'Chiedi prima di scrivere in più riquadri', copyOnSelect: 'Copia alla selezione', quick: 'Terminale a discesa',
  pasteTitle: 'Incollare più righe?', pasteBody: 'Ogni riga può essere eseguita come comando.', paste: 'Incolla', cancel: 'Annulla', running: 'in esecuzione', empty: 'Ancora nessun terminale',
  connect: 'Connetti', password: 'Password', upload: 'Carica…', download: 'Scarica', newFolder: 'Nuova cartella', delete: 'Elimina', up: 'Su',
  shared: 'Condiviso con tutti i terminali del gruppo (i programmi lo leggono in $KEEPER_SHARED_DIR/notes.md)', tabNotes: 'Note di questa scheda',
  missing: 'Non installato', start: 'Avvia', url: 'Indirizzo', open: 'Apri', save: 'Salva', name: 'Nome', default: 'Predefinito',
};

const ru: Dict = {
  title: 'Терминал', newTab: 'Новая вкладка', newTerminal: 'Новый терминал', splitRight: 'Разделить вправо', splitDown: 'Разделить вниз', close: 'Закрыть', closePane: 'Закрыть панель',
  zoom: 'Развернуть панель', broadcast: 'Печатать во все панели', broadcastOn: 'Ввод идёт во все панели этой вкладки', profiles: 'Профили', shells: 'Оболочки', sshHosts: 'SSH-серверы',
  webTools: 'Веб-инструменты', editor: 'Редактор кода', notebook: 'Блокноты', webPage: 'Веб-страница на этом компьютере', files: 'Файлы', notes: 'Заметки', sessions: 'Сеансы',
  settings: 'Настройки терминала', keybindings: 'Сочетания клавиш', triggers: 'Триггеры', workspaces: 'Рабочие пространства', saveWorkspace: 'Сохранить расположение…',
  detach: 'Оставить работать в фоне', restart: 'Начать заново здесь', restored: 'Восстановлено с прошлого раза — ничего не запущено.', exited: 'Программа завершилась',
  search: 'Искать в истории', clear: 'Очистить', rename: 'Переименовать', clone: 'Терминал-близнец (та же папка)', mirror: 'Показать в другой панели', group: 'Группа',
  openIn: 'Открыть папку в…', isolate: 'Хранить входы этого профиля отдельно', isolateHome: 'Дать ему и свою домашнюю папку', locale: 'Язык программ',
  keepAlive: 'Когда окна Keeper закрываются', keepWindow: 'Хранить терминалы до выхода из Keeper', keepQuit: 'Оставлять работать и после выхода', keepNever: 'Завершать вместе с окном',
  pasteGuard: 'Спрашивать перед вставкой нескольких строк', confirmBroadcast: 'Спрашивать перед вводом в несколько панелей', copyOnSelect: 'Копировать при выделении', quick: 'Выпадающий терминал',
  pasteTitle: 'Вставить несколько строк?', pasteBody: 'Каждая строка может выполниться как команда.', paste: 'Вставить', cancel: 'Отмена', running: 'работает', empty: 'Терминалов пока нет',
  connect: 'Подключиться', password: 'Пароль', upload: 'Загрузить…', download: 'Скачать', newFolder: 'Новая папка', delete: 'Удалить', up: 'Вверх',
  shared: 'Общие для всех терминалов группы (программы читают их в $KEEPER_SHARED_DIR/notes.md)', tabNotes: 'Заметки этой вкладки',
  missing: 'Не установлено', start: 'Запустить', url: 'Адрес', open: 'Открыть', save: 'Сохранить', name: 'Имя', default: 'По умолчанию',
};

const hi: Dict = {
  title: 'टर्मिनल', newTab: 'नया टैब', newTerminal: 'नया टर्मिनल', splitRight: 'दाईं ओर बाँटें', splitDown: 'नीचे बाँटें', close: 'बंद करें', closePane: 'पैन बंद करें',
  zoom: 'पैन बड़ा करें', broadcast: 'हर पैन में टाइप करें', broadcastOn: 'टाइपिंग इस टैब के हर पैन में जाती है', profiles: 'प्रोफ़ाइल', shells: 'शेल', sshHosts: 'SSH होस्ट',
  webTools: 'वेब टूल', editor: 'कोड एडिटर', notebook: 'नोटबुक', webPage: 'इस कंप्यूटर पर वेब पेज', files: 'फ़ाइलें', notes: 'नोट्स', sessions: 'सत्र',
  settings: 'टर्मिनल सेटिंग्स', keybindings: 'कीबोर्ड शॉर्टकट', triggers: 'ट्रिगर', workspaces: 'वर्कस्पेस', saveWorkspace: 'यह लेआउट सहेजें…',
  detach: 'पृष्ठभूमि में चलने दें', restart: 'यहीं फिर से शुरू करें', restored: 'पिछली बार से बहाल — कुछ नहीं चल रहा।', exited: 'प्रोग्राम बंद हो गया',
  search: 'इतिहास में खोजें', clear: 'साफ़ करें', rename: 'नाम बदलें', clone: 'जुड़वाँ टर्मिनल (वही फ़ोल्डर)', mirror: 'दूसरे पैन में दिखाएँ', group: 'समूह',
  openIn: 'फ़ोल्डर इसमें खोलें…', isolate: 'इस प्रोफ़ाइल के साइन-इन अलग रखें', isolateHome: 'इसे अपना होम फ़ोल्डर भी दें', locale: 'प्रोग्रामों की भाषा',
  keepAlive: 'जब Keeper की खिड़कियाँ बंद हों', keepWindow: 'Keeper बंद होने तक टर्मिनल रखें', keepQuit: 'Keeper बंद होने के बाद भी चलने दें', keepNever: 'खिड़की के साथ बंद करें',
  pasteGuard: 'कई पंक्तियाँ चिपकाने से पहले पूछें', confirmBroadcast: 'कई पैन में टाइप करने से पहले पूछें', copyOnSelect: 'चुनते ही कॉपी करें', quick: 'ड्रॉप-डाउन टर्मिनल',
  pasteTitle: 'कई पंक्तियाँ चिपकाएँ?', pasteBody: 'हर पंक्ति एक कमांड के रूप में चल सकती है।', paste: 'चिपकाएँ', cancel: 'रद्द करें', running: 'चल रहा है', empty: 'अभी कोई टर्मिनल नहीं',
  connect: 'जोड़ें', password: 'पासवर्ड', upload: 'अपलोड…', download: 'डाउनलोड', newFolder: 'नया फ़ोल्डर', delete: 'हटाएँ', up: 'ऊपर',
  shared: 'समूह के हर टर्मिनल के साथ साझा (प्रोग्राम इसे $KEEPER_SHARED_DIR/notes.md में पढ़ सकते हैं)', tabNotes: 'इस टैब के नोट्स',
  missing: 'इंस्टॉल नहीं', start: 'शुरू करें', url: 'पता', open: 'खोलें', save: 'सहेजें', name: 'नाम', default: 'डिफ़ॉल्ट',
};

const ja: Dict = {
  title: 'ターミナル', newTab: '新しいタブ', newTerminal: '新しいターミナル', splitRight: '右に分割', splitDown: '下に分割', close: '閉じる', closePane: 'ペインを閉じる',
  zoom: 'ペインを拡大', broadcast: 'すべてのペインに入力', broadcastOn: '入力はこのタブのすべてのペインに送られます', profiles: 'プロファイル', shells: 'シェル', sshHosts: 'SSH ホスト',
  webTools: 'Web ツール', editor: 'コードエディタ', notebook: 'ノートブック', webPage: 'このコンピュータの Web ページ', files: 'ファイル', notes: 'メモ', sessions: 'セッション',
  settings: 'ターミナル設定', keybindings: 'キーボードショートカット', triggers: 'トリガー', workspaces: 'ワークスペース', saveWorkspace: 'このレイアウトを保存…',
  detach: 'バックグラウンドで実行を続ける', restart: 'ここで再開', restored: '前回から復元されました — 何も実行されていません。', exited: 'プログラムが終了しました',
  search: '履歴を検索', clear: 'クリア', rename: '名前を変更', clone: '姉妹ターミナル（同じフォルダ）', mirror: '別のペインに表示', group: 'グループ',
  openIn: 'フォルダを開く…', isolate: 'このプロファイルのサインインを分ける', isolateHome: '専用のホームフォルダも使う', locale: 'プログラムの言語',
  keepAlive: 'Keeper のウインドウを閉じたとき', keepWindow: 'Keeper を終了するまでターミナルを残す', keepQuit: 'Keeper 終了後も実行を続ける', keepNever: 'ウインドウと一緒に終了する',
  pasteGuard: '複数行を貼り付ける前に確認', confirmBroadcast: '複数のペインに入力する前に確認', copyOnSelect: '選択したらコピー', quick: 'ドロップダウンターミナル',
  pasteTitle: '複数行を貼り付けますか？', pasteBody: '各行がコマンドとして実行される可能性があります。', paste: '貼り付け', cancel: 'キャンセル', running: '実行中', empty: 'まだターミナルがありません',
  connect: '接続', password: 'パスワード', upload: 'アップロード…', download: 'ダウンロード', newFolder: '新規フォルダ', delete: '削除', up: '上へ',
  shared: 'グループ内のすべてのターミナルと共有（プログラムは $KEEPER_SHARED_DIR/notes.md で読めます）', tabNotes: 'このタブのメモ',
  missing: '未インストール', start: '開始', url: 'アドレス', open: '開く', save: '保存', name: '名前', default: 'デフォルト',
};

const zhCN: Dict = {
  title: '终端', newTab: '新标签页', newTerminal: '新终端', splitRight: '向右拆分', splitDown: '向下拆分', close: '关闭', closePane: '关闭窗格',
  zoom: '放大窗格', broadcast: '输入到所有窗格', broadcastOn: '输入会发送到此标签页的所有窗格', profiles: '配置', shells: 'Shell', sshHosts: 'SSH 主机',
  webTools: '网页工具', editor: '代码编辑器', notebook: '笔记本', webPage: '本机上的网页', files: '文件', notes: '笔记', sessions: '会话',
  settings: '终端设置', keybindings: '键盘快捷键', triggers: '触发器', workspaces: '工作区', saveWorkspace: '保存此布局…',
  detach: '在后台继续运行', restart: '在此重新开始', restored: '已从上次恢复——没有程序在运行。', exited: '程序已结束',
  search: '在历史中查找', clear: '清除', rename: '重命名', clone: '姊妹终端（同一文件夹）', mirror: '在另一个窗格中显示', group: '分组',
  openIn: '用…打开文件夹', isolate: '让此配置的登录信息独立', isolateHome: '同时给它独立的主文件夹', locale: '程序使用的语言',
  keepAlive: '关闭 Keeper 窗口时', keepWindow: '保留终端直到退出 Keeper', keepQuit: '退出 Keeper 后仍继续运行', keepNever: '随窗口一起结束',
  pasteGuard: '粘贴多行前询问', confirmBroadcast: '向多个窗格输入前询问', copyOnSelect: '选中即复制', quick: '下拉式终端',
  pasteTitle: '粘贴多行？', pasteBody: '每一行都可能作为命令运行。', paste: '粘贴', cancel: '取消', running: '运行中', empty: '还没有终端',
  connect: '连接', password: '密码', upload: '上传…', download: '下载', newFolder: '新建文件夹', delete: '删除', up: '上一级',
  shared: '与该组的所有终端共享（程序可在 $KEEPER_SHARED_DIR/notes.md 读取）', tabNotes: '此标签页的笔记',
  missing: '未安装', start: '启动', url: '地址', open: '打开', save: '保存', name: '名称', default: '默认',
};

const DICTS: Record<string, Dict> = { en, es, de, fr, 'pt-BR': ptBR, it, ru, hi, ja, 'zh-CN': zhCN };

export function termText(lang: string, key: string): string {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}

/** Every language has every word (checked by the tests). */
export const TERM_LANGS = Object.keys(DICTS);
export const TERM_KEYS = Object.keys(en);
export const termDictionary = (lang: string) => DICTS[lang];

/** Locales offered for programs inside a profile. */
export const PROGRAM_LOCALES = ['', 'en_US.UTF-8', 'en_GB.UTF-8', 'es_ES.UTF-8', 'de_DE.UTF-8', 'fr_FR.UTF-8', 'pt_BR.UTF-8', 'it_IT.UTF-8', 'ru_RU.UTF-8', 'hi_IN.UTF-8', 'ja_JP.UTF-8', 'zh_CN.UTF-8', 'C.UTF-8'];
