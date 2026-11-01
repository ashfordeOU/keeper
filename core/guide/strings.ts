// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The guide's words in Keeper's ten languages, and the names systems give their
// own settings (so a step can say "Privacy & Security" the way the person's Mac
// says it). Missing system names fall back to English.

export const GUIDE_LANGS = ['en', 'es', 'de', 'fr', 'pt-BR', 'it', 'ru', 'hi', 'ja', 'zh-CN'] as const;
export type GuideLang = (typeof GUIDE_LANGS)[number];

type Table = Record<string, Record<GuideLang, string>>;

/** Buttons and labels of the guide itself. Every key has all ten languages (a test checks). */
export const GUIDE_UI: Table = {
  guide: { en: 'Guide', es: 'Guía', de: 'Anleitung', fr: 'Guide', 'pt-BR': 'Guia', it: 'Guida', ru: 'Подсказка', hi: 'मार्गदर्शिका', ja: 'ガイド', 'zh-CN': '指南' },
  openForMe: { en: 'Open it for me', es: 'Ábrelo por mí', de: 'Für mich öffnen', fr: 'L’ouvrir pour moi', 'pt-BR': 'Abrir para mim', it: 'Aprilo per me', ru: 'Открыть за меня', hi: 'मेरे लिए खोलें', ja: '代わりに開く', 'zh-CN': '帮我打开' },
  didIt: { en: 'I did it — check', es: 'Ya está — comprobar', de: 'Erledigt — prüfen', fr: 'C’est fait — vérifier', 'pt-BR': 'Feito — verificar', it: 'Fatto — controlla', ru: 'Готово — проверить', hi: 'हो गया — जाँचें', ja: '完了 — 確認する', 'zh-CN': '我已完成 — 检查' },
  skip: { en: 'Skip', es: 'Omitir', de: 'Überspringen', fr: 'Passer', 'pt-BR': 'Pular', it: 'Salta', ru: 'Пропустить', hi: 'छोड़ें', ja: 'スキップ', 'zh-CN': '跳过' },
  next: { en: 'Next', es: 'Siguiente', de: 'Weiter', fr: 'Suivant', 'pt-BR': 'Próximo', it: 'Avanti', ru: 'Далее', hi: 'आगे', ja: '次へ', 'zh-CN': '下一步' },
  back: { en: 'Back', es: 'Atrás', de: 'Zurück', fr: 'Retour', 'pt-BR': 'Voltar', it: 'Indietro', ru: 'Назад', hi: 'पीछे', ja: '戻る', 'zh-CN': '上一步' },
  done: { en: 'Done', es: 'Hecho', de: 'Erledigt', fr: 'Terminé', 'pt-BR': 'Concluído', it: 'Fatto', ru: 'Готово', hi: 'पूरा हुआ', ja: '完了', 'zh-CN': '已完成' },
  stillNeeded: { en: 'Still needed', es: 'Aún pendiente', de: 'Noch nötig', fr: 'Encore nécessaire', 'pt-BR': 'Ainda necessário', it: 'Ancora da fare', ru: 'Ещё нужно', hi: 'अभी भी ज़रूरी', ja: 'まだ必要です', 'zh-CN': '仍需处理' },
  stepOf: { en: 'Step {n} of {total}', es: 'Paso {n} de {total}', de: 'Schritt {n} von {total}', fr: 'Étape {n} sur {total}', 'pt-BR': 'Passo {n} de {total}', it: 'Passo {n} di {total}', ru: 'Шаг {n} из {total}', hi: 'चरण {n} / {total}', ja: 'ステップ {n} / {total}', 'zh-CN': '第 {n} 步，共 {total} 步' },
  todo: { en: 'To do', es: 'Pendiente', de: 'Zu erledigen', fr: 'À faire', 'pt-BR': 'A fazer', it: 'Da fare', ru: 'Нужно сделать', hi: 'करने के लिए', ja: 'やること', 'zh-CN': '待办' },
  fix: { en: 'Fix', es: 'Arreglar', de: 'Beheben', fr: 'Corriger', 'pt-BR': 'Corrigir', it: 'Correggi', ru: 'Исправить', hi: 'ठीक करें', ja: '修正', 'zh-CN': '修复' },
  snooze: { en: 'Remind me in a week', es: 'Recordar en una semana', de: 'In einer Woche erinnern', fr: 'Me le rappeler dans une semaine', 'pt-BR': 'Lembrar em uma semana', it: 'Ricordamelo tra una settimana', ru: 'Напомнить через неделю', hi: 'एक हफ़्ते बाद याद दिलाएँ', ja: '1 週間後に通知', 'zh-CN': '一周后提醒我' },
  ignore: { en: 'Ignore', es: 'Ignorar', de: 'Ignorieren', fr: 'Ignorer', 'pt-BR': 'Ignorar', it: 'Ignora', ru: 'Игнорировать', hi: 'अनदेखा करें', ja: '無視', 'zh-CN': '忽略' },
  whatChanges: { en: 'What will change', es: 'Qué cambiará', de: 'Was sich ändert', fr: 'Ce qui va changer', 'pt-BR': 'O que vai mudar', it: 'Cosa cambierà', ru: 'Что изменится', hi: 'क्या बदलेगा', ja: '変更される内容', 'zh-CN': '将会更改的内容' },
  doIt: { en: 'Do it', es: 'Hacerlo', de: 'Ausführen', fr: 'Le faire', 'pt-BR': 'Fazer', it: 'Procedi', ru: 'Выполнить', hi: 'करें', ja: '実行', 'zh-CN': '执行' },
  undo: { en: 'Undo', es: 'Deshacer', de: 'Rückgängig', fr: 'Annuler', 'pt-BR': 'Desfazer', it: 'Annulla', ru: 'Отменить', hi: 'पूर्ववत करें', ja: '取り消す', 'zh-CN': '撤销' },
  explain: { en: 'Explain', es: 'Explicar', de: 'Erklären', fr: 'Expliquer', 'pt-BR': 'Explicar', it: 'Spiega', ru: 'Объяснить', hi: 'समझाएँ', ja: '説明する', 'zh-CN': '解释' },
  walkMe: { en: 'Walk me through it', es: 'Guíame paso a paso', de: 'Schritt für Schritt erklären', fr: 'Me guider pas à pas', 'pt-BR': 'Me guie passo a passo', it: 'Guidami passo passo', ru: 'Провести по шагам', hi: 'मुझे कदम-दर-कदम बताएँ', ja: '手順を案内して', 'zh-CN': '一步步带我做' },
  howDoI: { en: 'How do I…?', es: '¿Cómo…?', de: 'Wie kann ich…?', fr: 'Comment…?', 'pt-BR': 'Como…?', it: 'Come…?', ru: 'Как…?', hi: 'मैं कैसे…?', ja: 'どうすれば…？', 'zh-CN': '如何……？' },
  keepOnTop: { en: 'Keep this on top while I do it', es: 'Mantener visible mientras lo hago', de: 'Im Vordergrund halten', fr: 'Garder au premier plan', 'pt-BR': 'Manter visível enquanto faço', it: 'Tienilo in primo piano', ru: 'Держать поверх окон', hi: 'करते समय इसे ऊपर रखें', ja: '作業中は手前に表示', 'zh-CN': '操作时保持在最前' },
  resume: { en: 'Resume', es: 'Reanudar', de: 'Fortsetzen', fr: 'Reprendre', 'pt-BR': 'Retomar', it: 'Riprendi', ru: 'Продолжить', hi: 'फिर से शुरू करें', ja: '再開', 'zh-CN': '继续' },
  allGood: { en: 'Nothing to do — all good.', es: 'Nada pendiente: todo bien.', de: 'Nichts zu tun – alles gut.', fr: 'Rien à faire : tout va bien.', 'pt-BR': 'Nada a fazer — tudo certo.', it: 'Niente da fare: tutto a posto.', ru: 'Делать нечего — всё в порядке.', hi: 'करने को कुछ नहीं — सब ठीक है।', ja: 'やることはありません。問題なしです。', 'zh-CN': '没有待办事项，一切正常。' },
  checking: { en: 'Checking…', es: 'Comprobando…', de: 'Wird geprüft…', fr: 'Vérification…', 'pt-BR': 'Verificando…', it: 'Controllo…', ru: 'Проверка…', hi: 'जाँच हो रही है…', ja: '確認中…', 'zh-CN': '正在检查…' },
  why: { en: 'Why it matters', es: 'Por qué importa', de: 'Warum es wichtig ist', fr: 'Pourquoi c’est important', 'pt-BR': 'Por que importa', it: 'Perché è importante', ru: 'Почему это важно', hi: 'यह क्यों ज़रूरी है', ja: 'なぜ重要か', 'zh-CN': '为什么重要' },
  needsAdmin: { en: 'Your computer will ask for your password.', es: 'El ordenador te pedirá la contraseña.', de: 'Der Computer fragt nach deinem Passwort.', fr: 'L’ordinateur demandera votre mot de passe.', 'pt-BR': 'O computador vai pedir sua senha.', it: 'Il computer chiederà la password.', ru: 'Компьютер запросит пароль.', hi: 'कंप्यूटर आपका पासवर्ड माँगेगा।', ja: 'パスワードの入力を求められます。', 'zh-CN': '电脑会要求输入密码。' },
  cantUndo: { en: 'This cannot be undone.', es: 'No se puede deshacer.', de: 'Das kann nicht rückgängig gemacht werden.', fr: 'Cette action est irréversible.', 'pt-BR': 'Não é possível desfazer.', it: 'Non si può annullare.', ru: 'Это нельзя отменить.', hi: 'इसे पूर्ववत नहीं किया जा सकता।', ja: '元に戻せません。', 'zh-CN': '此操作无法撤销。' },
};

/**
 * The systems' own names for their settings, by language. Apple's and
 * Microsoft's published wording where known; a missing language shows English.
 */
export const OS_TERMS: Record<string, Partial<Record<GuideLang, string>>> = {
  'mac.systemSettings': { en: 'System Settings', es: 'Ajustes del Sistema', de: 'Systemeinstellungen', fr: 'Réglages Système', 'pt-BR': 'Ajustes do Sistema', it: 'Impostazioni di Sistema', ja: 'システム設定', 'zh-CN': '系统设置', ru: 'Системные настройки' },
  'mac.privacySecurity': { en: 'Privacy & Security', es: 'Privacidad y seguridad', de: 'Datenschutz & Sicherheit', fr: 'Confidentialité et sécurité', 'pt-BR': 'Privacidade e Segurança', it: 'Privacy e sicurezza', ja: 'プライバシーとセキュリティ', 'zh-CN': '隐私与安全性', ru: 'Конфиденциальность и безопасность' },
  'mac.camera': { en: 'Camera', es: 'Cámara', de: 'Kamera', fr: 'Caméra', 'pt-BR': 'Câmera', it: 'Fotocamera', ja: 'カメラ', 'zh-CN': '摄像头', ru: 'Камера' },
  'mac.microphone': { en: 'Microphone', es: 'Micrófono', de: 'Mikrofon', fr: 'Micro', 'pt-BR': 'Microfone', it: 'Microfono', ja: 'マイク', 'zh-CN': '麦克风', ru: 'Микрофон' },
  'mac.screenRecording': { en: 'Screen Recording', es: 'Grabación de pantalla', de: 'Bildschirmaufnahme', fr: 'Enregistrement de l’écran', 'pt-BR': 'Gravação de Tela', it: 'Registrazione schermo', ja: '画面収録', 'zh-CN': '屏幕录制', ru: 'Запись экрана' },
  'mac.fullDiskAccess': { en: 'Full Disk Access', es: 'Acceso total al disco', de: 'Festplattenvollzugriff', fr: 'Accès complet au disque', 'pt-BR': 'Acesso Total ao Disco', it: 'Accesso completo al disco', ja: 'フルディスクアクセス', 'zh-CN': '完全磁盘访问权限', ru: 'Доступ к диску' },
  'mac.fileVault': { en: 'FileVault', es: 'FileVault', de: 'FileVault', fr: 'FileVault', 'pt-BR': 'FileVault', it: 'FileVault', ja: 'FileVault', 'zh-CN': '文件保险箱', ru: 'FileVault' },
  'mac.turnOn': { en: 'Turn On…', es: 'Activar…', de: 'Aktivieren …', fr: 'Activer…', 'pt-BR': 'Ativar…', it: 'Attiva…', ja: 'オンにする…', 'zh-CN': '打开…', ru: 'Включить…' },
  'mac.firewall': { en: 'Firewall', es: 'Firewall', de: 'Firewall', fr: 'Coupe-feu', 'pt-BR': 'Firewall', it: 'Firewall', ja: 'ファイアウォール', 'zh-CN': '防火墙', ru: 'Брандмауэр' },
  'mac.loginItems': { en: 'Login Items', es: 'Ítems de inicio', de: 'Anmeldeobjekte', fr: 'Ouverture', 'pt-BR': 'Itens de Início', it: 'Elementi login', ja: 'ログイン項目', 'zh-CN': '登录项', ru: 'Объекты входа' },
  'mac.softwareUpdate': { en: 'Software Update', es: 'Actualización de software', de: 'Softwareupdate', fr: 'Mise à jour de logiciels', 'pt-BR': 'Atualização de Software', it: 'Aggiornamento Software', ja: 'ソフトウェアアップデート', 'zh-CN': '软件更新', ru: 'Обновление ПО' },
  'mac.storage': { en: 'Storage', es: 'Almacenamiento', de: 'Speicher', fr: 'Stockage', 'pt-BR': 'Armazenamento', it: 'Spazio di archiviazione', ja: 'ストレージ', 'zh-CN': '储存空间', ru: 'Хранилище' },
  'mac.optimizeStorage': { en: 'Optimize Storage', es: 'Optimizar almacenamiento', de: 'Speicher optimieren', fr: 'Optimiser le stockage', 'pt-BR': 'Otimizar Armazenamento', it: 'Ottimizza spazio', ja: 'ストレージを最適化', 'zh-CN': '优化储存空间', ru: 'Оптимизировать хранилище' },
  'mac.sharing': { en: 'Sharing', es: 'Compartir', de: 'Teilen', fr: 'Partage', 'pt-BR': 'Compartilhamento', it: 'Condivisione', ja: '共有', 'zh-CN': '共享', ru: 'Общий доступ' },
  'win.settings': { en: 'Settings', es: 'Configuración', de: 'Einstellungen', fr: 'Paramètres', 'pt-BR': 'Configurações', it: 'Impostazioni', ja: '設定', 'zh-CN': '设置', ru: 'Параметры', hi: 'सेटिंग्स' },
  'win.privacySecurity': { en: 'Privacy & security', es: 'Privacidad y seguridad', de: 'Datenschutz und Sicherheit', fr: 'Confidentialité et sécurité', 'pt-BR': 'Privacidade e segurança', it: 'Privacy e sicurezza', ja: 'プライバシーとセキュリティ', 'zh-CN': '隐私和安全性', ru: 'Конфиденциальность и защита' },
  'win.camera': { en: 'Camera', es: 'Cámara', de: 'Kamera', fr: 'Caméra', 'pt-BR': 'Câmera', it: 'Fotocamera', ja: 'カメラ', 'zh-CN': '相机', ru: 'Камера' },
  'win.microphone': { en: 'Microphone', es: 'Micrófono', de: 'Mikrofon', fr: 'Microphone', 'pt-BR': 'Microfone', it: 'Microfono', ja: 'マイク', 'zh-CN': '麦克风', ru: 'Микрофон' },
  'win.storageSense': { en: 'Storage Sense', es: 'Sensor de almacenamiento', de: 'Speicheroptimierung', fr: 'Assistant de stockage', 'pt-BR': 'Sensor de Armazenamento', it: 'Sensore memoria', ja: 'ストレージ センサー', 'zh-CN': '存储感知', ru: 'Контроль памяти' },
  'win.windowsUpdate': { en: 'Windows Update', es: 'Windows Update', de: 'Windows Update', fr: 'Windows Update', 'pt-BR': 'Windows Update', it: 'Windows Update', ja: 'Windows Update', 'zh-CN': 'Windows 更新', ru: 'Центр обновления Windows' },
  'win.windowsSecurity': { en: 'Windows Security', es: 'Seguridad de Windows', de: 'Windows-Sicherheit', fr: 'Sécurité Windows', 'pt-BR': 'Segurança do Windows', it: 'Sicurezza di Windows', ja: 'Windows セキュリティ', 'zh-CN': 'Windows 安全中心', ru: 'Безопасность Windows' },
  'win.deviceEncryption': { en: 'Device encryption', es: 'Cifrado de dispositivo', de: 'Geräteverschlüsselung', fr: 'Chiffrement de l’appareil', 'pt-BR': 'Criptografia de dispositivo', it: 'Crittografia dispositivo', ja: 'デバイスの暗号化', 'zh-CN': '设备加密', ru: 'Шифрование устройства' },
  'win.startup': { en: 'Startup', es: 'Inicio', de: 'Autostart', fr: 'Démarrage', 'pt-BR': 'Inicialização', it: 'Avvio', ja: 'スタートアップ', 'zh-CN': '启动', ru: 'Автозагрузка' },
  'win.firewall': { en: 'Firewall & network protection', es: 'Firewall y protección de red', de: 'Firewall- & Netzwerkschutz', fr: 'Pare-feu et protection du réseau', 'pt-BR': 'Firewall e proteção de rede', it: 'Firewall e protezione della rete', ja: 'ファイアウォールとネットワーク保護', 'zh-CN': '防火墙和网络保护', ru: 'Брандмауэр и безопасность сети' },
  'linux.settings': { en: 'Settings', es: 'Configuración', de: 'Einstellungen', fr: 'Paramètres', 'pt-BR': 'Configurações', it: 'Impostazioni', ja: '設定', 'zh-CN': '设置', ru: 'Параметры' },
  'linux.privacy': { en: 'Privacy', es: 'Privacidad', de: 'Datenschutz', fr: 'Confidentialité', 'pt-BR': 'Privacidade', it: 'Privacy', ja: 'プライバシー', 'zh-CN': '隐私', ru: 'Конфиденциальность' },
};

export function guideLang(code: string | undefined): GuideLang {
  const c = (code ?? 'en').toLowerCase();
  const exact = GUIDE_LANGS.find((l) => l.toLowerCase() === c);
  if (exact) return exact;
  const base = GUIDE_LANGS.find((l) => l.split('-')[0].toLowerCase() === c.split('-')[0]);
  return base ?? 'en';
}

/** A guide label in the person's language, with {placeholders} filled. */
export function gt(key: string, lang: GuideLang, vars: Record<string, string | number> = {}): string {
  const s = GUIDE_UI[key]?.[lang] ?? GUIDE_UI[key]?.en ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** A system's name for a setting in the person's language (English when not known). */
export function osTerm(key: string, lang: GuideLang): string {
  const t = OS_TERMS[key];
  return t?.[lang] ?? t?.en ?? key;
}

/** Fills {term:mac.camera} placeholders in step text. */
export function fillTerms(text: string, lang: GuideLang): string {
  return text.replace(/\{term:([\w.]+)\}/g, (_m, k: string) => `“${osTerm(k, lang)}”`);
}
