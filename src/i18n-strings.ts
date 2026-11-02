// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The interface's words in every language Keeper speaks. Pure data, so it can
// be tested without a window; useT() lives in i18n.ts.

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'system', name: 'Same as system' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'it', name: 'Italiano' },
  { code: 'ru', name: 'Русский' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
  { code: 'zh-CN', name: '简体中文' },
];

type Dict = Record<string, string>;

const en: Dict = {
  'nav.convert': 'Convert', 'nav.capture': 'Capture', 'nav.widgets': 'Widgets',
  'nav.home': 'Home', 'nav.recents': 'Recents', 'nav.browse': 'Browse', 'nav.downloads': 'Downloaded From', 'nav.weather': 'Weather',
  'section.library': 'Library', 'section.saved': 'Saved searches', 'section.pinned': 'Pinned', 'section.tags': 'Tags', 'section.tidy': 'Tidy', 'section.system': 'System', 'section.more': 'More',
  'kind.image': 'Images', 'kind.video': 'Videos', 'kind.audio': 'Music', 'kind.document': 'Documents', 'kind.archive': 'Archives', 'kind.installer': 'Installers', 'kind.app': 'Apps', 'kind.code': 'Code', 'kind.other': 'Other', 'kind.screenshot': 'Screenshots',
  'kindAll.image': 'All Images', 'kindAll.video': 'All Videos', 'kindAll.audio': 'All Music', 'kindAll.document': 'All Documents', 'kindAll.archive': 'All Archives', 'kindAll.installer': 'All Installers', 'kindAll.app': 'All Apps', 'kindAll.code': 'All Code', 'kindAll.other': 'All Other Files', 'kindAll.screenshot': 'All Screenshots',
  'nav.cleanup': 'Clean Up', 'nav.duplicates': 'Duplicates', 'nav.space': 'Space Map', 'nav.large': 'Large Files', 'nav.rules': 'Automations',
  'nav.health': 'Health', 'nav.startup': 'Startup Items', 'nav.apps': 'Applications', 'nav.protection': 'Privacy & Security',
  'nav.netactivity': 'Network Activity', 'nav.vpn': 'VPN',
  'nav.assistant': 'Assistant', 'nav.toolbox': 'Toolbox', 'nav.island': 'Island', 'nav.history': 'History', 'nav.settings': 'Settings',
  'search.placeholder': 'Search in plain English — “pdfs from gmail last month”, “screenshots with wifi password”',
  'common.open': 'Open', 'common.show': 'Show', 'common.copy': 'Copy', 'common.copied': 'Copied', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.delete': 'Delete', 'common.rename': 'Rename', 'common.trash': 'Move to Trash', 'common.undo': 'Undo', 'common.done': 'Done', 'common.back': 'Back', 'common.refresh': 'Refresh', 'common.loading': 'Loading…', 'common.add': 'Add', 'common.remove': 'Remove', 'common.close': 'Close', 'common.preview': 'Preview', 'common.apply': 'Apply',
  'settings.appearance': 'Appearance', 'settings.look': 'Look', 'settings.playful': 'Playful', 'settings.minimal': 'Minimal', 'settings.theme': 'Theme', 'settings.system': 'System', 'settings.light': 'Light', 'settings.dark': 'Dark', 'settings.language': 'Language', 'settings.library': 'Library', 'settings.startup': 'Start Keeper when you sign in', 'settings.updates': 'Updates', 'settings.about': 'About', 'settings.checkUpdates': 'Check for updates',
  'island.home': 'Home', 'island.shelf': 'Shelf', 'island.clipboard': 'Clipboard', 'island.agents': 'Agents', 'island.focus': 'Focus', 'island.today': 'Today',
  'weather.title': 'Weather', 'weather.hourly': 'Next 24 hours', 'weather.week': 'Next 10 days', 'weather.radar': 'Radar', 'weather.compare': 'Compare places', 'weather.trips': 'Trips from your calendar', 'weather.alerts': 'Alerts', 'weather.addPlace': 'Add a place',
  'health.title': 'Health', 'health.today': 'Today', 'health.topToday': 'What worked hardest today',
  'tidy.title': 'Tidy this folder', 'tidy.byKind': 'By kind', 'tidy.byMonth': 'By month', 'tidy.byExt': 'By extension',
  'widget.weekOf': 'Week of {date}', 'widget.thisWeek': 'This week', 'widget.prevWeek': 'Previous week', 'widget.nextWeek': 'Next week', 'widget.add': '+ add', 'widget.addTask': 'Add a task or event to {day}', 'widget.markDone': 'Mark done', 'widget.overlap': 'Overlap', 'widget.noOverlap': 'No hours everyone works', 'widget.now': 'Now', 'widget.addCity': '+ add city', 'widget.unknownCity': 'Unknown city or time zone', 'widget.removeCity': 'Remove {city}', 'widget.start': 'Start', 'widget.pause': 'Pause', 'widget.resume': 'Resume', 'widget.reset': 'Reset', 'widget.plusMin': '+1 min', 'widget.timer': 'Timer', 'widget.minutes': '{n} min', 'widget.night': 'Night', 'widget.morning': 'Morning', 'widget.afternoon': 'Afternoon', 'widget.evening': 'Evening', 'widget.today': 'Today', 'widget.noForecast': 'Choose a place in Island settings to see the forecast.', 'widget.rain': 'Rain',
};

const es: Dict = {
  'nav.convert': 'Convertir', 'nav.capture': 'Capturar', 'nav.widgets': 'Widgets',
  'nav.home': 'Inicio', 'nav.recents': 'Recientes', 'nav.browse': 'Explorar', 'nav.downloads': 'Origen de descargas', 'nav.weather': 'Tiempo',
  'section.library': 'Biblioteca', 'section.saved': 'Búsquedas guardadas', 'section.pinned': 'Fijados', 'section.tags': 'Etiquetas', 'section.tidy': 'Ordenar', 'section.system': 'Sistema', 'section.more': 'Más',
  'kind.image': 'Imágenes', 'kind.video': 'Vídeos', 'kind.audio': 'Música', 'kind.document': 'Documentos', 'kind.archive': 'Archivos comprimidos', 'kind.installer': 'Instaladores', 'kind.app': 'Apps', 'kind.code': 'Código', 'kind.other': 'Otros', 'kind.screenshot': 'Capturas de pantalla',
  'kindAll.image': 'Todas las imágenes', 'kindAll.video': 'Todos los vídeos', 'kindAll.audio': 'Toda la música', 'kindAll.document': 'Todos los documentos', 'kindAll.archive': 'Todos los archivos comprimidos', 'kindAll.installer': 'Todos los instaladores', 'kindAll.app': 'Todas las apps', 'kindAll.code': 'Todo el código', 'kindAll.other': 'Todos los demás archivos', 'kindAll.screenshot': 'Todas las capturas de pantalla',
  'nav.cleanup': 'Limpiar', 'nav.duplicates': 'Duplicados', 'nav.space': 'Mapa de espacio', 'nav.large': 'Archivos grandes', 'nav.rules': 'Automatizaciones',
  'nav.health': 'Estado', 'nav.startup': 'Inicio de sesión', 'nav.apps': 'Aplicaciones', 'nav.protection': 'Privacidad y seguridad',
  'nav.netactivity': 'Actividad de red', 'nav.vpn': 'VPN',
  'nav.assistant': 'Asistente', 'nav.toolbox': 'Herramientas', 'nav.island': 'Isla', 'nav.history': 'Historial', 'nav.settings': 'Ajustes',
  'search.placeholder': 'Busca con tus palabras: «pdfs de gmail del mes pasado», «capturas con la contraseña del wifi»',
  'common.open': 'Abrir', 'common.show': 'Mostrar', 'common.copy': 'Copiar', 'common.copied': 'Copiado', 'common.cancel': 'Cancelar', 'common.save': 'Guardar', 'common.delete': 'Eliminar', 'common.rename': 'Renombrar', 'common.trash': 'Mover a la papelera', 'common.undo': 'Deshacer', 'common.done': 'Listo', 'common.back': 'Atrás', 'common.refresh': 'Actualizar', 'common.loading': 'Cargando…', 'common.add': 'Añadir', 'common.remove': 'Quitar', 'common.close': 'Cerrar', 'common.preview': 'Vista previa', 'common.apply': 'Aplicar',
  'settings.appearance': 'Apariencia', 'settings.look': 'Estilo', 'settings.playful': 'Colorido', 'settings.minimal': 'Minimalista', 'settings.theme': 'Tema', 'settings.system': 'Sistema', 'settings.light': 'Claro', 'settings.dark': 'Oscuro', 'settings.language': 'Idioma', 'settings.library': 'Biblioteca', 'settings.startup': 'Abrir Keeper al iniciar sesión', 'settings.updates': 'Actualizaciones', 'settings.about': 'Acerca de', 'settings.checkUpdates': 'Buscar actualizaciones',
  'island.home': 'Inicio', 'island.shelf': 'Estante', 'island.clipboard': 'Portapapeles', 'island.agents': 'Agentes', 'island.focus': 'Concentración', 'island.today': 'Hoy',
  'weather.title': 'Tiempo', 'weather.hourly': 'Próximas 24 horas', 'weather.week': 'Próximos 10 días', 'weather.radar': 'Radar', 'weather.compare': 'Comparar lugares', 'weather.trips': 'Viajes de tu calendario', 'weather.alerts': 'Avisos', 'weather.addPlace': 'Añadir un lugar',
  'health.title': 'Estado', 'health.today': 'Hoy', 'health.topToday': 'Lo que más trabajó hoy',
  'tidy.title': 'Ordenar esta carpeta', 'tidy.byKind': 'Por tipo', 'tidy.byMonth': 'Por mes', 'tidy.byExt': 'Por extensión',
  'widget.weekOf': 'Semana del {date}', 'widget.thisWeek': 'Esta semana', 'widget.prevWeek': 'Semana anterior', 'widget.nextWeek': 'Semana siguiente', 'widget.add': '+ añadir', 'widget.addTask': 'Añadir una tarea o evento el {day}', 'widget.markDone': 'Marcar como hecha', 'widget.overlap': 'Coinciden', 'widget.noOverlap': 'Ninguna hora en la que trabajen todos', 'widget.now': 'Ahora', 'widget.addCity': '+ añadir ciudad', 'widget.unknownCity': 'Ciudad o zona horaria desconocida', 'widget.removeCity': 'Quitar {city}', 'widget.start': 'Iniciar', 'widget.pause': 'Pausar', 'widget.resume': 'Reanudar', 'widget.reset': 'Restablecer', 'widget.plusMin': '+1 min', 'widget.timer': 'Temporizador', 'widget.minutes': '{n} min', 'widget.night': 'Noche', 'widget.morning': 'Mañana', 'widget.afternoon': 'Tarde', 'widget.evening': 'Atardecer', 'widget.today': 'Hoy', 'widget.noForecast': 'Elige un lugar en los ajustes de la Isla para ver el pronóstico.', 'widget.rain': 'Lluvia',
};

const de: Dict = {
  'nav.convert': 'Konvertieren', 'nav.capture': 'Aufnehmen', 'nav.widgets': 'Widgets',
  'nav.home': 'Start', 'nav.recents': 'Zuletzt', 'nav.browse': 'Durchsuchen', 'nav.downloads': 'Herkunft der Downloads', 'nav.weather': 'Wetter',
  'section.library': 'Mediathek', 'section.saved': 'Gespeicherte Suchen', 'section.pinned': 'Angeheftet', 'section.tags': 'Tags', 'section.tidy': 'Aufräumen', 'section.system': 'System', 'section.more': 'Mehr',
  'kind.image': 'Bilder', 'kind.video': 'Videos', 'kind.audio': 'Musik', 'kind.document': 'Dokumente', 'kind.archive': 'Archive', 'kind.installer': 'Installer', 'kind.app': 'Apps', 'kind.code': 'Code', 'kind.other': 'Sonstiges', 'kind.screenshot': 'Bildschirmfotos',
  'kindAll.image': 'Alle Bilder', 'kindAll.video': 'Alle Videos', 'kindAll.audio': 'Alle Musik', 'kindAll.document': 'Alle Dokumente', 'kindAll.archive': 'Alle Archive', 'kindAll.installer': 'Alle Installer', 'kindAll.app': 'Alle Apps', 'kindAll.code': 'Aller Code', 'kindAll.other': 'Alle sonstigen Dateien', 'kindAll.screenshot': 'Alle Bildschirmfotos',
  'nav.cleanup': 'Bereinigen', 'nav.duplicates': 'Duplikate', 'nav.space': 'Speicherkarte', 'nav.large': 'Große Dateien', 'nav.rules': 'Automatisierungen',
  'nav.health': 'Zustand', 'nav.startup': 'Autostart', 'nav.apps': 'Programme', 'nav.protection': 'Datenschutz & Sicherheit',
  'nav.netactivity': 'Netzwerkaktivität', 'nav.vpn': 'VPN',
  'nav.assistant': 'Assistent', 'nav.toolbox': 'Werkzeuge', 'nav.island': 'Insel', 'nav.history': 'Verlauf', 'nav.settings': 'Einstellungen',
  'search.placeholder': 'In eigenen Worten suchen – „PDFs von Gmail letzten Monat“, „Bildschirmfotos mit WLAN-Passwort“',
  'common.open': 'Öffnen', 'common.show': 'Zeigen', 'common.copy': 'Kopieren', 'common.copied': 'Kopiert', 'common.cancel': 'Abbrechen', 'common.save': 'Sichern', 'common.delete': 'Löschen', 'common.rename': 'Umbenennen', 'common.trash': 'In den Papierkorb', 'common.undo': 'Widerrufen', 'common.done': 'Fertig', 'common.back': 'Zurück', 'common.refresh': 'Aktualisieren', 'common.loading': 'Wird geladen …', 'common.add': 'Hinzufügen', 'common.remove': 'Entfernen', 'common.close': 'Schließen', 'common.preview': 'Vorschau', 'common.apply': 'Anwenden',
  'settings.appearance': 'Darstellung', 'settings.look': 'Stil', 'settings.playful': 'Farbenfroh', 'settings.minimal': 'Schlicht', 'settings.theme': 'Design', 'settings.system': 'System', 'settings.light': 'Hell', 'settings.dark': 'Dunkel', 'settings.language': 'Sprache', 'settings.library': 'Mediathek', 'settings.startup': 'Keeper bei der Anmeldung starten', 'settings.updates': 'Updates', 'settings.about': 'Über', 'settings.checkUpdates': 'Nach Updates suchen',
  'island.home': 'Start', 'island.shelf': 'Ablage', 'island.clipboard': 'Zwischenablage', 'island.agents': 'Agenten', 'island.focus': 'Fokus', 'island.today': 'Heute',
  'weather.title': 'Wetter', 'weather.hourly': 'Nächste 24 Stunden', 'weather.week': 'Nächste 10 Tage', 'weather.radar': 'Radar', 'weather.compare': 'Orte vergleichen', 'weather.trips': 'Reisen aus deinem Kalender', 'weather.alerts': 'Warnungen', 'weather.addPlace': 'Ort hinzufügen',
  'health.title': 'Zustand', 'health.today': 'Heute', 'health.topToday': 'Was heute am meisten gearbeitet hat',
  'tidy.title': 'Diesen Ordner aufräumen', 'tidy.byKind': 'Nach Art', 'tidy.byMonth': 'Nach Monat', 'tidy.byExt': 'Nach Endung',
  'widget.weekOf': 'Woche vom {date}', 'widget.thisWeek': 'Diese Woche', 'widget.prevWeek': 'Vorherige Woche', 'widget.nextWeek': 'Nächste Woche', 'widget.add': '+ hinzufügen', 'widget.addTask': 'Aufgabe oder Termin am {day} hinzufügen', 'widget.markDone': 'Als erledigt markieren', 'widget.overlap': 'Überschneidung', 'widget.noOverlap': 'Keine Stunden, in denen alle arbeiten', 'widget.now': 'Jetzt', 'widget.addCity': '+ Stadt hinzufügen', 'widget.unknownCity': 'Unbekannte Stadt oder Zeitzone', 'widget.removeCity': '{city} entfernen', 'widget.start': 'Starten', 'widget.pause': 'Pause', 'widget.resume': 'Fortsetzen', 'widget.reset': 'Zurücksetzen', 'widget.plusMin': '+1 Min.', 'widget.timer': 'Timer', 'widget.minutes': '{n} Min.', 'widget.night': 'Nacht', 'widget.morning': 'Morgen', 'widget.afternoon': 'Nachmittag', 'widget.evening': 'Abend', 'widget.today': 'Heute', 'widget.noForecast': 'Wähle in den Island-Einstellungen einen Ort, um die Vorhersage zu sehen.', 'widget.rain': 'Regen',
};

const fr: Dict = {
  'nav.convert': 'Convertir', 'nav.capture': 'Capturer', 'nav.widgets': 'Widgets',
  'nav.home': 'Accueil', 'nav.recents': 'Récents', 'nav.browse': 'Parcourir', 'nav.downloads': 'Provenance des téléchargements', 'nav.weather': 'Météo',
  'section.library': 'Bibliothèque', 'section.saved': 'Recherches enregistrées', 'section.pinned': 'Épinglés', 'section.tags': 'Étiquettes', 'section.tidy': 'Ranger', 'section.system': 'Système', 'section.more': 'Plus',
  'kind.image': 'Images', 'kind.video': 'Vidéos', 'kind.audio': 'Musique', 'kind.document': 'Documents', 'kind.archive': 'Archives', 'kind.installer': 'Installateurs', 'kind.app': 'Apps', 'kind.code': 'Code', 'kind.other': 'Autres', 'kind.screenshot': 'Captures d’écran',
  'kindAll.image': 'Toutes les images', 'kindAll.video': 'Toutes les vidéos', 'kindAll.audio': 'Toute la musique', 'kindAll.document': 'Tous les documents', 'kindAll.archive': 'Toutes les archives', 'kindAll.installer': 'Tous les installateurs', 'kindAll.app': 'Toutes les apps', 'kindAll.code': 'Tout le code', 'kindAll.other': 'Tous les autres fichiers', 'kindAll.screenshot': 'Toutes les captures d’écran',
  'nav.cleanup': 'Nettoyer', 'nav.duplicates': 'Doublons', 'nav.space': 'Carte de l’espace', 'nav.large': 'Gros fichiers', 'nav.rules': 'Automatisations',
  'nav.health': 'État', 'nav.startup': 'Ouverture au démarrage', 'nav.apps': 'Applications', 'nav.protection': 'Confidentialité et sécurité',
  'nav.netactivity': 'Activité réseau', 'nav.vpn': 'VPN',
  'nav.assistant': 'Assistant', 'nav.toolbox': 'Boîte à outils', 'nav.island': 'Île', 'nav.history': 'Historique', 'nav.settings': 'Réglages',
  'search.placeholder': 'Cherchez avec vos mots : « pdf de gmail le mois dernier », « captures avec le mot de passe wifi »',
  'common.open': 'Ouvrir', 'common.show': 'Afficher', 'common.copy': 'Copier', 'common.copied': 'Copié', 'common.cancel': 'Annuler', 'common.save': 'Enregistrer', 'common.delete': 'Supprimer', 'common.rename': 'Renommer', 'common.trash': 'Placer dans la corbeille', 'common.undo': 'Annuler l’action', 'common.done': 'Terminé', 'common.back': 'Retour', 'common.refresh': 'Actualiser', 'common.loading': 'Chargement…', 'common.add': 'Ajouter', 'common.remove': 'Retirer', 'common.close': 'Fermer', 'common.preview': 'Aperçu', 'common.apply': 'Appliquer',
  'settings.appearance': 'Apparence', 'settings.look': 'Style', 'settings.playful': 'Coloré', 'settings.minimal': 'Épuré', 'settings.theme': 'Thème', 'settings.system': 'Système', 'settings.light': 'Clair', 'settings.dark': 'Sombre', 'settings.language': 'Langue', 'settings.library': 'Bibliothèque', 'settings.startup': 'Ouvrir Keeper à l’ouverture de session', 'settings.updates': 'Mises à jour', 'settings.about': 'À propos', 'settings.checkUpdates': 'Rechercher des mises à jour',
  'island.home': 'Accueil', 'island.shelf': 'Étagère', 'island.clipboard': 'Presse-papiers', 'island.agents': 'Agents', 'island.focus': 'Concentration', 'island.today': 'Aujourd’hui',
  'weather.title': 'Météo', 'weather.hourly': '24 prochaines heures', 'weather.week': '10 prochains jours', 'weather.radar': 'Radar', 'weather.compare': 'Comparer des lieux', 'weather.trips': 'Voyages de votre calendrier', 'weather.alerts': 'Alertes', 'weather.addPlace': 'Ajouter un lieu',
  'health.title': 'État', 'health.today': 'Aujourd’hui', 'health.topToday': 'Ce qui a le plus travaillé aujourd’hui',
  'tidy.title': 'Ranger ce dossier', 'tidy.byKind': 'Par type', 'tidy.byMonth': 'Par mois', 'tidy.byExt': 'Par extension',
  'widget.weekOf': 'Semaine du {date}', 'widget.thisWeek': 'Cette semaine', 'widget.prevWeek': 'Semaine précédente', 'widget.nextWeek': 'Semaine suivante', 'widget.add': '+ ajouter', 'widget.addTask': 'Ajouter une tâche ou un événement le {day}', 'widget.markDone': 'Marquer comme fait', 'widget.overlap': 'Chevauchement', 'widget.noOverlap': 'Aucune heure où tout le monde travaille', 'widget.now': 'Maintenant', 'widget.addCity': '+ ajouter une ville', 'widget.unknownCity': 'Ville ou fuseau horaire inconnu', 'widget.removeCity': 'Retirer {city}', 'widget.start': 'Démarrer', 'widget.pause': 'Pause', 'widget.resume': 'Reprendre', 'widget.reset': 'Réinitialiser', 'widget.plusMin': '+1 min', 'widget.timer': 'Minuteur', 'widget.minutes': '{n} min', 'widget.night': 'Nuit', 'widget.morning': 'Matin', 'widget.afternoon': 'Après-midi', 'widget.evening': 'Soir', 'widget.today': 'Aujourd’hui', 'widget.noForecast': 'Choisissez un lieu dans les réglages de l’Île pour voir les prévisions.', 'widget.rain': 'Pluie',
};

const ptBR: Dict = {
  'nav.convert': 'Converter', 'nav.capture': 'Capturar', 'nav.widgets': 'Widgets',
  'nav.home': 'Início', 'nav.recents': 'Recentes', 'nav.browse': 'Navegar', 'nav.downloads': 'Origem dos downloads', 'nav.weather': 'Clima',
  'section.library': 'Biblioteca', 'section.saved': 'Buscas salvas', 'section.pinned': 'Fixados', 'section.tags': 'Etiquetas', 'section.tidy': 'Organizar', 'section.system': 'Sistema', 'section.more': 'Mais',
  'kind.image': 'Imagens', 'kind.video': 'Vídeos', 'kind.audio': 'Músicas', 'kind.document': 'Documentos', 'kind.archive': 'Arquivos compactados', 'kind.installer': 'Instaladores', 'kind.app': 'Apps', 'kind.code': 'Código', 'kind.other': 'Outros', 'kind.screenshot': 'Capturas de tela',
  'kindAll.image': 'Todas as imagens', 'kindAll.video': 'Todos os vídeos', 'kindAll.audio': 'Todas as músicas', 'kindAll.document': 'Todos os documentos', 'kindAll.archive': 'Todos os arquivos compactados', 'kindAll.installer': 'Todos os instaladores', 'kindAll.app': 'Todos os apps', 'kindAll.code': 'Todo o código', 'kindAll.other': 'Todos os outros arquivos', 'kindAll.screenshot': 'Todas as capturas de tela',
  'nav.cleanup': 'Limpeza', 'nav.duplicates': 'Duplicados', 'nav.space': 'Mapa de espaço', 'nav.large': 'Arquivos grandes', 'nav.rules': 'Automações',
  'nav.health': 'Saúde', 'nav.startup': 'Itens de inicialização', 'nav.apps': 'Aplicativos', 'nav.protection': 'Privacidade e segurança',
  'nav.netactivity': 'Atividade de rede', 'nav.vpn': 'VPN',
  'nav.assistant': 'Assistente', 'nav.toolbox': 'Ferramentas', 'nav.island': 'Ilha', 'nav.history': 'Histórico', 'nav.settings': 'Ajustes',
  'search.placeholder': 'Busque do seu jeito: “pdfs do gmail do mês passado”, “capturas com a senha do wi-fi”',
  'common.open': 'Abrir', 'common.show': 'Mostrar', 'common.copy': 'Copiar', 'common.copied': 'Copiado', 'common.cancel': 'Cancelar', 'common.save': 'Salvar', 'common.delete': 'Apagar', 'common.rename': 'Renomear', 'common.trash': 'Mover para a lixeira', 'common.undo': 'Desfazer', 'common.done': 'Pronto', 'common.back': 'Voltar', 'common.refresh': 'Atualizar', 'common.loading': 'Carregando…', 'common.add': 'Adicionar', 'common.remove': 'Remover', 'common.close': 'Fechar', 'common.preview': 'Pré-visualizar', 'common.apply': 'Aplicar',
  'settings.appearance': 'Aparência', 'settings.look': 'Estilo', 'settings.playful': 'Colorido', 'settings.minimal': 'Minimalista', 'settings.theme': 'Tema', 'settings.system': 'Sistema', 'settings.light': 'Claro', 'settings.dark': 'Escuro', 'settings.language': 'Idioma', 'settings.library': 'Biblioteca', 'settings.startup': 'Abrir o Keeper ao entrar', 'settings.updates': 'Atualizações', 'settings.about': 'Sobre', 'settings.checkUpdates': 'Procurar atualizações',
  'island.home': 'Início', 'island.shelf': 'Prateleira', 'island.clipboard': 'Área de transferência', 'island.agents': 'Agentes', 'island.focus': 'Foco', 'island.today': 'Hoje',
  'weather.title': 'Clima', 'weather.hourly': 'Próximas 24 horas', 'weather.week': 'Próximos 10 dias', 'weather.radar': 'Radar', 'weather.compare': 'Comparar lugares', 'weather.trips': 'Viagens da sua agenda', 'weather.alerts': 'Alertas', 'weather.addPlace': 'Adicionar um lugar',
  'health.title': 'Saúde', 'health.today': 'Hoje', 'health.topToday': 'O que mais trabalhou hoje',
  'tidy.title': 'Organizar esta pasta', 'tidy.byKind': 'Por tipo', 'tidy.byMonth': 'Por mês', 'tidy.byExt': 'Por extensão',
  'widget.weekOf': 'Semana de {date}', 'widget.thisWeek': 'Esta semana', 'widget.prevWeek': 'Semana anterior', 'widget.nextWeek': 'Próxima semana', 'widget.add': '+ adicionar', 'widget.addTask': 'Adicionar tarefa ou evento em {day}', 'widget.markDone': 'Marcar como feita', 'widget.overlap': 'Em comum', 'widget.noOverlap': 'Nenhum horário em que todos trabalham', 'widget.now': 'Agora', 'widget.addCity': '+ adicionar cidade', 'widget.unknownCity': 'Cidade ou fuso horário desconhecido', 'widget.removeCity': 'Remover {city}', 'widget.start': 'Iniciar', 'widget.pause': 'Pausar', 'widget.resume': 'Retomar', 'widget.reset': 'Redefinir', 'widget.plusMin': '+1 min', 'widget.timer': 'Timer', 'widget.minutes': '{n} min', 'widget.night': 'Noite', 'widget.morning': 'Manhã', 'widget.afternoon': 'Tarde', 'widget.evening': 'Noitinha', 'widget.today': 'Hoje', 'widget.noForecast': 'Escolha um lugar nos ajustes da Ilha para ver a previsão.', 'widget.rain': 'Chuva',
};

const it: Dict = {
  'nav.convert': 'Converti', 'nav.capture': 'Cattura', 'nav.widgets': 'Widget',
  'nav.home': 'Home', 'nav.recents': 'Recenti', 'nav.browse': 'Sfoglia', 'nav.downloads': 'Provenienza dei download', 'nav.weather': 'Meteo',
  'section.library': 'Libreria', 'section.saved': 'Ricerche salvate', 'section.pinned': 'Fissati', 'section.tags': 'Tag', 'section.tidy': 'Riordina', 'section.system': 'Sistema', 'section.more': 'Altro',
  'kind.image': 'Immagini', 'kind.video': 'Video', 'kind.audio': 'Musica', 'kind.document': 'Documenti', 'kind.archive': 'Archivi', 'kind.installer': 'Installer', 'kind.app': 'App', 'kind.code': 'Codice', 'kind.other': 'Altro', 'kind.screenshot': 'Istantanee schermo',
  'kindAll.image': 'Tutte le immagini', 'kindAll.video': 'Tutti i video', 'kindAll.audio': 'Tutta la musica', 'kindAll.document': 'Tutti i documenti', 'kindAll.archive': 'Tutti gli archivi', 'kindAll.installer': 'Tutti gli installer', 'kindAll.app': 'Tutte le app', 'kindAll.code': 'Tutto il codice', 'kindAll.other': 'Tutti gli altri file', 'kindAll.screenshot': 'Tutte le istantanee schermo',
  'nav.cleanup': 'Pulizia', 'nav.duplicates': 'Duplicati', 'nav.space': 'Mappa dello spazio', 'nav.large': 'File grandi', 'nav.rules': 'Automazioni',
  'nav.health': 'Stato', 'nav.startup': 'Elementi di avvio', 'nav.apps': 'Applicazioni', 'nav.protection': 'Privacy e sicurezza',
  'nav.netactivity': 'Attività di rete', 'nav.vpn': 'VPN',
  'nav.assistant': 'Assistente', 'nav.toolbox': 'Strumenti', 'nav.island': 'Isola', 'nav.history': 'Cronologia', 'nav.settings': 'Impostazioni',
  'search.placeholder': 'Cerca a parole tue: “pdf da gmail del mese scorso”, “istantanee con la password del wifi”',
  'common.open': 'Apri', 'common.show': 'Mostra', 'common.copy': 'Copia', 'common.copied': 'Copiato', 'common.cancel': 'Annulla', 'common.save': 'Salva', 'common.delete': 'Elimina', 'common.rename': 'Rinomina', 'common.trash': 'Sposta nel cestino', 'common.undo': 'Annulla azione', 'common.done': 'Fine', 'common.back': 'Indietro', 'common.refresh': 'Aggiorna', 'common.loading': 'Caricamento…', 'common.add': 'Aggiungi', 'common.remove': 'Rimuovi', 'common.close': 'Chiudi', 'common.preview': 'Anteprima', 'common.apply': 'Applica',
  'settings.appearance': 'Aspetto', 'settings.look': 'Stile', 'settings.playful': 'Vivace', 'settings.minimal': 'Essenziale', 'settings.theme': 'Tema', 'settings.system': 'Sistema', 'settings.light': 'Chiaro', 'settings.dark': 'Scuro', 'settings.language': 'Lingua', 'settings.library': 'Libreria', 'settings.startup': 'Apri Keeper all’accesso', 'settings.updates': 'Aggiornamenti', 'settings.about': 'Informazioni', 'settings.checkUpdates': 'Cerca aggiornamenti',
  'island.home': 'Home', 'island.shelf': 'Ripiano', 'island.clipboard': 'Appunti', 'island.agents': 'Agenti', 'island.focus': 'Concentrazione', 'island.today': 'Oggi',
  'weather.title': 'Meteo', 'weather.hourly': 'Prossime 24 ore', 'weather.week': 'Prossimi 10 giorni', 'weather.radar': 'Radar', 'weather.compare': 'Confronta luoghi', 'weather.trips': 'Viaggi dal tuo calendario', 'weather.alerts': 'Allerte', 'weather.addPlace': 'Aggiungi un luogo',
  'health.title': 'Stato', 'health.today': 'Oggi', 'health.topToday': 'Cosa ha lavorato di più oggi',
  'tidy.title': 'Riordina questa cartella', 'tidy.byKind': 'Per tipo', 'tidy.byMonth': 'Per mese', 'tidy.byExt': 'Per estensione',
  'widget.weekOf': 'Settimana del {date}', 'widget.thisWeek': 'Questa settimana', 'widget.prevWeek': 'Settimana precedente', 'widget.nextWeek': 'Settimana successiva', 'widget.add': '+ aggiungi', 'widget.addTask': 'Aggiungi un’attività o un evento il {day}', 'widget.markDone': 'Segna come fatto', 'widget.overlap': 'Sovrapposizione', 'widget.noOverlap': 'Nessuna ora in cui lavorano tutti', 'widget.now': 'Adesso', 'widget.addCity': '+ aggiungi città', 'widget.unknownCity': 'Città o fuso orario sconosciuto', 'widget.removeCity': 'Rimuovi {city}', 'widget.start': 'Avvia', 'widget.pause': 'Pausa', 'widget.resume': 'Riprendi', 'widget.reset': 'Azzera', 'widget.plusMin': '+1 min', 'widget.timer': 'Timer', 'widget.minutes': '{n} min', 'widget.night': 'Notte', 'widget.morning': 'Mattina', 'widget.afternoon': 'Pomeriggio', 'widget.evening': 'Sera', 'widget.today': 'Oggi', 'widget.noForecast': 'Scegli un luogo nelle impostazioni dell’Isola per vedere le previsioni.', 'widget.rain': 'Pioggia',
};

const ru: Dict = {
  'nav.convert': 'Конвертер', 'nav.capture': 'Захват экрана', 'nav.widgets': 'Виджеты',
  'nav.home': 'Главная', 'nav.recents': 'Недавние', 'nav.browse': 'Обзор', 'nav.downloads': 'Откуда загрузки', 'nav.weather': 'Погода',
  'section.library': 'Медиатека', 'section.saved': 'Сохранённые поиски', 'section.pinned': 'Закреплённые', 'section.tags': 'Теги', 'section.tidy': 'Порядок', 'section.system': 'Система', 'section.more': 'Ещё',
  'kind.image': 'Изображения', 'kind.video': 'Видео', 'kind.audio': 'Музыка', 'kind.document': 'Документы', 'kind.archive': 'Архивы', 'kind.installer': 'Установщики', 'kind.app': 'Приложения', 'kind.code': 'Код', 'kind.other': 'Другое', 'kind.screenshot': 'Снимки экрана',
  'kindAll.image': 'Все изображения', 'kindAll.video': 'Все видео', 'kindAll.audio': 'Вся музыка', 'kindAll.document': 'Все документы', 'kindAll.archive': 'Все архивы', 'kindAll.installer': 'Все установщики', 'kindAll.app': 'Все приложения', 'kindAll.code': 'Весь код', 'kindAll.other': 'Все другие файлы', 'kindAll.screenshot': 'Все снимки экрана',
  'nav.cleanup': 'Очистка', 'nav.duplicates': 'Дубликаты', 'nav.space': 'Карта места', 'nav.large': 'Большие файлы', 'nav.rules': 'Автоматизация',
  'nav.health': 'Состояние', 'nav.startup': 'Автозагрузка', 'nav.apps': 'Программы', 'nav.protection': 'Конфиденциальность и защита',
  'nav.netactivity': 'Сетевая активность', 'nav.vpn': 'VPN',
  'nav.assistant': 'Помощник', 'nav.toolbox': 'Инструменты', 'nav.island': 'Остров', 'nav.history': 'История', 'nav.settings': 'Настройки',
  'search.placeholder': 'Ищите своими словами: «pdf из gmail за прошлый месяц», «скриншоты с паролем от wi-fi»',
  'common.open': 'Открыть', 'common.show': 'Показать', 'common.copy': 'Копировать', 'common.copied': 'Скопировано', 'common.cancel': 'Отмена', 'common.save': 'Сохранить', 'common.delete': 'Удалить', 'common.rename': 'Переименовать', 'common.trash': 'В корзину', 'common.undo': 'Отменить', 'common.done': 'Готово', 'common.back': 'Назад', 'common.refresh': 'Обновить', 'common.loading': 'Загрузка…', 'common.add': 'Добавить', 'common.remove': 'Убрать', 'common.close': 'Закрыть', 'common.preview': 'Просмотр', 'common.apply': 'Применить',
  'settings.appearance': 'Оформление', 'settings.look': 'Стиль', 'settings.playful': 'Яркий', 'settings.minimal': 'Строгий', 'settings.theme': 'Тема', 'settings.system': 'Как в системе', 'settings.light': 'Светлая', 'settings.dark': 'Тёмная', 'settings.language': 'Язык', 'settings.library': 'Медиатека', 'settings.startup': 'Запускать Keeper при входе', 'settings.updates': 'Обновления', 'settings.about': 'О программе', 'settings.checkUpdates': 'Проверить обновления',
  'island.home': 'Главная', 'island.shelf': 'Полка', 'island.clipboard': 'Буфер обмена', 'island.agents': 'Агенты', 'island.focus': 'Фокус', 'island.today': 'Сегодня',
  'weather.title': 'Погода', 'weather.hourly': 'Ближайшие 24 часа', 'weather.week': 'Ближайшие 10 дней', 'weather.radar': 'Радар', 'weather.compare': 'Сравнить места', 'weather.trips': 'Поездки из календаря', 'weather.alerts': 'Предупреждения', 'weather.addPlace': 'Добавить место',
  'health.title': 'Состояние', 'health.today': 'Сегодня', 'health.topToday': 'Что больше всего нагружало сегодня',
  'tidy.title': 'Навести порядок в папке', 'tidy.byKind': 'По типу', 'tidy.byMonth': 'По месяцам', 'tidy.byExt': 'По расширению',
  'widget.weekOf': 'Неделя с {date}', 'widget.thisWeek': 'Эта неделя', 'widget.prevWeek': 'Предыдущая неделя', 'widget.nextWeek': 'Следующая неделя', 'widget.add': '+ добавить', 'widget.addTask': 'Добавить задачу или событие на {day}', 'widget.markDone': 'Отметить выполненным', 'widget.overlap': 'Пересечение', 'widget.noOverlap': 'Нет часов, когда работают все', 'widget.now': 'Сейчас', 'widget.addCity': '+ добавить город', 'widget.unknownCity': 'Неизвестный город или часовой пояс', 'widget.removeCity': 'Убрать {city}', 'widget.start': 'Старт', 'widget.pause': 'Пауза', 'widget.resume': 'Продолжить', 'widget.reset': 'Сброс', 'widget.plusMin': '+1 мин', 'widget.timer': 'Таймер', 'widget.minutes': '{n} мин', 'widget.night': 'Ночь', 'widget.morning': 'Утро', 'widget.afternoon': 'День', 'widget.evening': 'Вечер', 'widget.today': 'Сегодня', 'widget.noForecast': 'Выберите место в настройках Острова, чтобы увидеть прогноз.', 'widget.rain': 'Дождь',
};

const hi: Dict = {
  'nav.convert': 'बदलें', 'nav.capture': 'कैप्चर', 'nav.widgets': 'विजेट',
  'nav.home': 'होम', 'nav.recents': 'हाल की फ़ाइलें', 'nav.browse': 'ब्राउज़ करें', 'nav.downloads': 'डाउनलोड कहाँ से', 'nav.weather': 'मौसम',
  'section.library': 'लाइब्रेरी', 'section.saved': 'सहेजी गई खोजें', 'section.pinned': 'पिन किए गए', 'section.tags': 'टैग', 'section.tidy': 'साफ़-सफ़ाई', 'section.system': 'सिस्टम', 'section.more': 'और',
  'kind.image': 'तस्वीरें', 'kind.video': 'वीडियो', 'kind.audio': 'संगीत', 'kind.document': 'दस्तावेज़', 'kind.archive': 'आर्काइव', 'kind.installer': 'इंस्टॉलर', 'kind.app': 'ऐप्स', 'kind.code': 'कोड', 'kind.other': 'अन्य', 'kind.screenshot': 'स्क्रीनशॉट',
  'kindAll.image': 'सभी तस्वीरें', 'kindAll.video': 'सभी वीडियो', 'kindAll.audio': 'सारा संगीत', 'kindAll.document': 'सभी दस्तावेज़', 'kindAll.archive': 'सभी आर्काइव', 'kindAll.installer': 'सभी इंस्टॉलर', 'kindAll.app': 'सभी ऐप्स', 'kindAll.code': 'सारा कोड', 'kindAll.other': 'सभी अन्य फ़ाइलें', 'kindAll.screenshot': 'सभी स्क्रीनशॉट',
  'nav.cleanup': 'सफ़ाई', 'nav.duplicates': 'डुप्लिकेट', 'nav.space': 'स्पेस मैप', 'nav.large': 'बड़ी फ़ाइलें', 'nav.rules': 'ऑटोमेशन',
  'nav.health': 'सेहत', 'nav.startup': 'स्टार्टअप आइटम', 'nav.apps': 'ऐप्लिकेशन', 'nav.protection': 'गोपनीयता और सुरक्षा',
  'nav.netactivity': 'नेटवर्क गतिविधि', 'nav.vpn': 'VPN',
  'nav.assistant': 'सहायक', 'nav.toolbox': 'टूलबॉक्स', 'nav.island': 'आइलैंड', 'nav.history': 'इतिहास', 'nav.settings': 'सेटिंग्स',
  'search.placeholder': 'अपने शब्दों में खोजें — “पिछले महीने gmail से आए pdf”, “wifi पासवर्ड वाले स्क्रीनशॉट”',
  'common.open': 'खोलें', 'common.show': 'दिखाएँ', 'common.copy': 'कॉपी करें', 'common.copied': 'कॉपी हो गया', 'common.cancel': 'रद्द करें', 'common.save': 'सहेजें', 'common.delete': 'हटाएँ', 'common.rename': 'नाम बदलें', 'common.trash': 'ट्रैश में डालें', 'common.undo': 'पहले जैसा करें', 'common.done': 'हो गया', 'common.back': 'वापस', 'common.refresh': 'रीफ़्रेश', 'common.loading': 'लोड हो रहा है…', 'common.add': 'जोड़ें', 'common.remove': 'हटाएँ', 'common.close': 'बंद करें', 'common.preview': 'पूर्वावलोकन', 'common.apply': 'लागू करें',
  'settings.appearance': 'रूप', 'settings.look': 'शैली', 'settings.playful': 'रंगीन', 'settings.minimal': 'सादा', 'settings.theme': 'थीम', 'settings.system': 'सिस्टम जैसा', 'settings.light': 'हल्की', 'settings.dark': 'गहरी', 'settings.language': 'भाषा', 'settings.library': 'लाइब्रेरी', 'settings.startup': 'साइन इन करते ही Keeper खोलें', 'settings.updates': 'अपडेट', 'settings.about': 'जानकारी', 'settings.checkUpdates': 'अपडेट देखें',
  'island.home': 'होम', 'island.shelf': 'शेल्फ़', 'island.clipboard': 'क्लिपबोर्ड', 'island.agents': 'एजेंट', 'island.focus': 'फ़ोकस', 'island.today': 'आज',
  'weather.title': 'मौसम', 'weather.hourly': 'अगले 24 घंटे', 'weather.week': 'अगले 10 दिन', 'weather.radar': 'रडार', 'weather.compare': 'जगहों की तुलना', 'weather.trips': 'कैलेंडर की यात्राएँ', 'weather.alerts': 'चेतावनियाँ', 'weather.addPlace': 'जगह जोड़ें',
  'health.title': 'सेहत', 'health.today': 'आज', 'health.topToday': 'आज सबसे ज़्यादा काम किसने किया',
  'tidy.title': 'यह फ़ोल्डर व्यवस्थित करें', 'tidy.byKind': 'प्रकार के अनुसार', 'tidy.byMonth': 'महीने के अनुसार', 'tidy.byExt': 'एक्सटेंशन के अनुसार',
  'widget.weekOf': '{date} का सप्ताह', 'widget.thisWeek': 'यह सप्ताह', 'widget.prevWeek': 'पिछला सप्ताह', 'widget.nextWeek': 'अगला सप्ताह', 'widget.add': '+ जोड़ें', 'widget.addTask': '{day} को काम या इवेंट जोड़ें', 'widget.markDone': 'पूरा हुआ चिह्नित करें', 'widget.overlap': 'साझा समय', 'widget.noOverlap': 'कोई ऐसा घंटा नहीं जब सब काम करते हों', 'widget.now': 'अभी', 'widget.addCity': '+ शहर जोड़ें', 'widget.unknownCity': 'अज्ञात शहर या समय क्षेत्र', 'widget.removeCity': '{city} हटाएँ', 'widget.start': 'शुरू करें', 'widget.pause': 'रोकें', 'widget.resume': 'जारी रखें', 'widget.reset': 'रीसेट', 'widget.plusMin': '+1 मिनट', 'widget.timer': 'टाइमर', 'widget.minutes': '{n} मिनट', 'widget.night': 'रात', 'widget.morning': 'सुबह', 'widget.afternoon': 'दोपहर', 'widget.evening': 'शाम', 'widget.today': 'आज', 'widget.noForecast': 'पूर्वानुमान देखने के लिए आइलैंड सेटिंग्स में कोई जगह चुनें।', 'widget.rain': 'बारिश',
};

const ja: Dict = {
  'nav.convert': '変換', 'nav.capture': 'キャプチャ', 'nav.widgets': 'ウィジェット',
  'nav.home': 'ホーム', 'nav.recents': '最近使った項目', 'nav.browse': 'ブラウズ', 'nav.downloads': 'ダウンロード元', 'nav.weather': '天気',
  'section.library': 'ライブラリ', 'section.saved': '保存した検索', 'section.pinned': 'ピン留め', 'section.tags': 'タグ', 'section.tidy': '整理', 'section.system': 'システム', 'section.more': 'その他',
  'kind.image': '画像', 'kind.video': 'ビデオ', 'kind.audio': 'ミュージック', 'kind.document': '書類', 'kind.archive': 'アーカイブ', 'kind.installer': 'インストーラ', 'kind.app': 'アプリ', 'kind.code': 'コード', 'kind.other': 'その他', 'kind.screenshot': 'スクリーンショット',
  'kindAll.image': 'すべての画像', 'kindAll.video': 'すべてのビデオ', 'kindAll.audio': 'すべてのミュージック', 'kindAll.document': 'すべての書類', 'kindAll.archive': 'すべてのアーカイブ', 'kindAll.installer': 'すべてのインストーラ', 'kindAll.app': 'すべてのアプリ', 'kindAll.code': 'すべてのコード', 'kindAll.other': 'その他すべて', 'kindAll.screenshot': 'すべてのスクリーンショット',
  'nav.cleanup': 'クリーンアップ', 'nav.duplicates': '重複ファイル', 'nav.space': '容量マップ', 'nav.large': '大きなファイル', 'nav.rules': '自動化',
  'nav.health': 'ヘルス', 'nav.startup': 'ログイン項目', 'nav.apps': 'アプリケーション', 'nav.protection': 'プライバシーとセキュリティ',
  'nav.netactivity': 'ネットワーク通信', 'nav.vpn': 'VPN',
  'nav.assistant': 'アシスタント', 'nav.toolbox': 'ツールボックス', 'nav.island': 'アイランド', 'nav.history': '履歴', 'nav.settings': '設定',
  'search.placeholder': '普段の言葉で検索 —「先月 gmail から届いた pdf」「wifi のパスワードが写ったスクショ」',
  'common.open': '開く', 'common.show': '表示', 'common.copy': 'コピー', 'common.copied': 'コピーしました', 'common.cancel': 'キャンセル', 'common.save': '保存', 'common.delete': '削除', 'common.rename': '名前を変更', 'common.trash': 'ゴミ箱に入れる', 'common.undo': '取り消す', 'common.done': '完了', 'common.back': '戻る', 'common.refresh': '更新', 'common.loading': '読み込み中…', 'common.add': '追加', 'common.remove': '取り除く', 'common.close': '閉じる', 'common.preview': 'プレビュー', 'common.apply': '適用',
  'settings.appearance': '外観', 'settings.look': 'スタイル', 'settings.playful': 'カラフル', 'settings.minimal': 'ミニマル', 'settings.theme': 'テーマ', 'settings.system': 'システムに合わせる', 'settings.light': 'ライト', 'settings.dark': 'ダーク', 'settings.language': '言語', 'settings.library': 'ライブラリ', 'settings.startup': 'ログイン時に Keeper を開く', 'settings.updates': 'アップデート', 'settings.about': 'Keeper について', 'settings.checkUpdates': 'アップデートを確認',
  'island.home': 'ホーム', 'island.shelf': 'シェルフ', 'island.clipboard': 'クリップボード', 'island.agents': 'エージェント', 'island.focus': '集中', 'island.today': '今日',
  'weather.title': '天気', 'weather.hourly': '24時間予報', 'weather.week': '10日間予報', 'weather.radar': 'レーダー', 'weather.compare': '場所を比較', 'weather.trips': 'カレンダーの予定先', 'weather.alerts': '警報・注意報', 'weather.addPlace': '場所を追加',
  'health.title': 'ヘルス', 'health.today': '今日', 'health.topToday': '今日いちばん負荷をかけたもの',
  'tidy.title': 'このフォルダを整理', 'tidy.byKind': '種類別', 'tidy.byMonth': '月別', 'tidy.byExt': '拡張子別',
  'widget.weekOf': '{date} の週', 'widget.thisWeek': '今週', 'widget.prevWeek': '前の週', 'widget.nextWeek': '次の週', 'widget.add': '+ 追加', 'widget.addTask': '{day} にタスクか予定を追加', 'widget.markDone': '完了にする', 'widget.overlap': '重なり', 'widget.noOverlap': '全員が働いている時間はありません', 'widget.now': '現在', 'widget.addCity': '+ 都市を追加', 'widget.unknownCity': '不明な都市またはタイムゾーン', 'widget.removeCity': '{city} を削除', 'widget.start': '開始', 'widget.pause': '一時停止', 'widget.resume': '再開', 'widget.reset': 'リセット', 'widget.plusMin': '+1 分', 'widget.timer': 'タイマー', 'widget.minutes': '{n} 分', 'widget.night': '夜間', 'widget.morning': '朝', 'widget.afternoon': '午後', 'widget.evening': '夕方', 'widget.today': '今日', 'widget.noForecast': '予報を見るにはアイランドの設定で場所を選んでください。', 'widget.rain': '雨',
};

const zh: Dict = {
  'nav.convert': '转换', 'nav.capture': '截取', 'nav.widgets': '小组件',
  'nav.home': '主页', 'nav.recents': '最近使用', 'nav.browse': '浏览', 'nav.downloads': '下载来源', 'nav.weather': '天气',
  'section.library': '资料库', 'section.saved': '已存搜索', 'section.pinned': '已固定', 'section.tags': '标签', 'section.tidy': '整理', 'section.system': '系统', 'section.more': '更多',
  'kind.image': '图片', 'kind.video': '视频', 'kind.audio': '音乐', 'kind.document': '文稿', 'kind.archive': '压缩包', 'kind.installer': '安装包', 'kind.app': '应用', 'kind.code': '代码', 'kind.other': '其他', 'kind.screenshot': '截图',
  'kindAll.image': '所有图片', 'kindAll.video': '所有视频', 'kindAll.audio': '所有音乐', 'kindAll.document': '所有文稿', 'kindAll.archive': '所有压缩包', 'kindAll.installer': '所有安装包', 'kindAll.app': '所有应用', 'kindAll.code': '所有代码', 'kindAll.other': '所有其他文件', 'kindAll.screenshot': '所有截图',
  'nav.cleanup': '清理', 'nav.duplicates': '重复文件', 'nav.space': '空间地图', 'nav.large': '大文件', 'nav.rules': '自动化',
  'nav.health': '运行状况', 'nav.startup': '启动项', 'nav.apps': '应用程序', 'nav.protection': '隐私与安全',
  'nav.netactivity': '网络活动', 'nav.vpn': 'VPN',
  'nav.assistant': '助手', 'nav.toolbox': '工具箱', 'nav.island': '灵动岛', 'nav.history': '历史记录', 'nav.settings': '设置',
  'search.placeholder': '用自己的话搜索——“上个月 gmail 发来的 pdf”“带 wifi 密码的截图”',
  'common.open': '打开', 'common.show': '显示', 'common.copy': '拷贝', 'common.copied': '已拷贝', 'common.cancel': '取消', 'common.save': '存储', 'common.delete': '删除', 'common.rename': '重新命名', 'common.trash': '移到废纸篓', 'common.undo': '撤销', 'common.done': '完成', 'common.back': '返回', 'common.refresh': '刷新', 'common.loading': '正在载入…', 'common.add': '添加', 'common.remove': '移除', 'common.close': '关闭', 'common.preview': '预览', 'common.apply': '应用',
  'settings.appearance': '外观', 'settings.look': '风格', 'settings.playful': '多彩', 'settings.minimal': '简约', 'settings.theme': '主题', 'settings.system': '跟随系统', 'settings.light': '浅色', 'settings.dark': '深色', 'settings.language': '语言', 'settings.library': '资料库', 'settings.startup': '登录时打开 Keeper', 'settings.updates': '更新', 'settings.about': '关于', 'settings.checkUpdates': '检查更新',
  'island.home': '主页', 'island.shelf': '暂存架', 'island.clipboard': '剪贴板', 'island.agents': '智能体', 'island.focus': '专注', 'island.today': '今天',
  'weather.title': '天气', 'weather.hourly': '未来 24 小时', 'weather.week': '未来 10 天', 'weather.radar': '雷达', 'weather.compare': '比较地点', 'weather.trips': '日历中的行程', 'weather.alerts': '预警', 'weather.addPlace': '添加地点',
  'health.title': '运行状况', 'health.today': '今天', 'health.topToday': '今天占用最多的程序',
  'tidy.title': '整理此文件夹', 'tidy.byKind': '按类型', 'tidy.byMonth': '按月份', 'tidy.byExt': '按扩展名',
  'widget.weekOf': '{date} 所在周', 'widget.thisWeek': '本周', 'widget.prevWeek': '上一周', 'widget.nextWeek': '下一周', 'widget.add': '+ 添加', 'widget.addTask': '在 {day} 添加任务或日程', 'widget.markDone': '标记为完成', 'widget.overlap': '重叠', 'widget.noOverlap': '没有所有人都在工作的时间', 'widget.now': '现在', 'widget.addCity': '+ 添加城市', 'widget.unknownCity': '未知的城市或时区', 'widget.removeCity': '移除 {city}', 'widget.start': '开始', 'widget.pause': '暂停', 'widget.resume': '继续', 'widget.reset': '重置', 'widget.plusMin': '+1 分钟', 'widget.timer': '计时器', 'widget.minutes': '{n} 分钟', 'widget.night': '夜间', 'widget.morning': '上午', 'widget.afternoon': '下午', 'widget.evening': '晚上', 'widget.today': '今天', 'widget.noForecast': '在灵动岛设置中选择地点即可查看预报。', 'widget.rain': '雨',
};

const DICTS: Record<string, Dict> = { en, es, de, fr, 'pt-BR': ptBR, pt: ptBR, it, ru, hi, ja, 'zh-CN': zh, zh };

/** Resolves "system" and regional variants ("es-MX" -> "es") to a dictionary we have. */
export function resolveLanguage(setting: string | undefined, system = typeof navigator !== 'undefined' ? navigator.language : 'en'): string {
  const want = !setting || setting === 'system' ? system : setting;
  if (DICTS[want]) return want;
  const base = want.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  if (base === 'zh') return 'zh-CN';
  return DICTS[base] ? base : 'en';
}

export function translate(lang: string, key: string): string {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}

export const TRANSLATION_KEYS = Object.keys(en);
export const DICTIONARIES = DICTS;
