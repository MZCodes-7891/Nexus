// Translates the app's main labels: navigation, page titles, tabs, and common buttons. Text is only ever swapped for an exact match, so user content and AI replies are never touched.
const LANGUAGE_ORDER = ['French', 'Spanish', 'German', 'Arabic', 'Urdu', 'Hindi', 'Chinese'];
const LANGUAGE_TAGS = { English: 'en', French: 'fr', Spanish: 'es', German: 'de', Arabic: 'ar', Urdu: 'ur', Hindi: 'hi', Chinese: 'zh' };
const TRANSLATIONS = [
    ['Home', 'Accueil', 'Inicio', 'Startseite', 'الرئيسية', 'ہوم', 'होम', '主页'],
    ['AI Chat', 'Discussion IA', 'Chat de IA', 'KI-Chat', 'محادثة الذكاء الاصطناعي', 'اے آئی چیٹ', 'एआई चैट', 'AI 聊天'],
    ['My Apps', 'Mes applications', 'Mis aplicaciones', 'Meine Apps', 'تطبيقاتي', 'میری ایپس', 'मेरे ऐप्स', '我的应用'],
    ['Documents', 'Documents', 'Documentos', 'Dokumente', 'المستندات', 'دستاویزات', 'दस्तावेज़', '文档'],
    ['Study Center', 'Centre d\'étude', 'Centro de estudio', 'Lernzentrum', 'مركز الدراسة', 'مطالعہ مرکز', 'अध्ययन केंद्र', '学习中心'],
    ['Research', 'Recherche', 'Investigación', 'Recherche', 'البحث', 'تحقیق', 'शोध', '研究'],
    ['Tasks', 'Tâches', 'Tareas', 'Aufgaben', 'المهام', 'کام', 'कार्य', '任务'],
    ['Calendar', 'Calendrier', 'Calendario', 'Kalender', 'التقويم', 'کیلنڈر', 'कैलेंडर', '日历'],
    ['Automations', 'Automatisations', 'Automatizaciones', 'Automatisierungen', 'الأتمتة', 'خودکار کام', 'स्वचालन', '自动化'],
    ['Connected Apps', 'Applications connectées', 'Aplicaciones conectadas', 'Verbundene Apps', 'التطبيقات المتصلة', 'منسلک ایپس', 'जुड़े ऐप्स', '已连接的应用'],
    ['App Control', 'Contrôle des applications', 'Control de aplicaciones', 'App-Steuerung', 'التحكم في التطبيقات', 'ایپ کنٹرول', 'ऐप नियंत्रण', '应用控制'],
    ['Memory', 'Mémoire', 'Memoria', 'Gedächtnis', 'الذاكرة', 'یادداشت', 'स्मृति', '记忆'],
    ['Settings', 'Paramètres', 'Ajustes', 'Einstellungen', 'الإعدادات', 'ترتیبات', 'सेटिंग्स', '设置'],
    ['Study sets', 'Ensembles d\'étude', 'Conjuntos de estudio', 'Lernsets', 'مجموعات الدراسة', 'مطالعہ سیٹ', 'अध्ययन सेट', '学习集'],
    ['D2L Practice', 'Pratique D2L', 'Práctica de D2L', 'D2L-Übung', 'تدريب D2L', 'D2L مشق', 'D2L अभ्यास', 'D2L 练习'],
    ['Assignments', 'Devoirs', 'Tareas escolares', 'Hausaufgaben', 'الواجبات', 'اسائنمنٹس', 'असाइनमेंट', '作业'],
    ['Library', 'Bibliothèque', 'Biblioteca', 'Bibliothek', 'المكتبة', 'لائبریری', 'लाइब्रेरी', '资料库'],
    ['Study guides', 'Guides d\'étude', 'Guías de estudio', 'Lernhilfen', 'أدلة الدراسة', 'مطالعہ گائیڈز', 'अध्ययन गाइड', '学习指南'],
    ['Flashcards', 'Cartes mémoire', 'Tarjetas', 'Karteikarten', 'البطاقات التعليمية', 'فلیش کارڈز', 'फ्लैशकार्ड', '抽认卡'],
    ['Practice tests', 'Tests d\'entraînement', 'Exámenes de práctica', 'Übungstests', 'اختبارات تدريبية', 'مشقی ٹیسٹ', 'अभ्यास परीक्षाएं', '模拟测试'],
    ['Quiz', 'Quiz', 'Cuestionario', 'Quiz', 'اختبار قصير', 'کوئز', 'क्विज़', '测验'],
    ['Planner', 'Planificateur', 'Planificador', 'Planer', 'المخطط', 'منصوبہ ساز', 'योजनाकार', '计划'],
    ['Progress', 'Progrès', 'Progreso', 'Fortschritt', 'التقدم', 'پیش رفت', 'प्रगति', '进度'],
    ['Learn', 'Apprendre', 'Aprender', 'Lernen', 'تعلّم', 'سیکھیں', 'सीखें', '学习'],
    ['Test', 'Test', 'Examen', 'Test', 'اختبار', 'ٹیسٹ', 'परीक्षा', '测试'],
    ['Match', 'Associer', 'Emparejar', 'Zuordnen', 'مطابقة', 'ملائیں', 'मिलान', '配对'],
    ['Day', 'Jour', 'Día', 'Tag', 'يوم', 'دن', 'दिन', '日'],
    ['Week', 'Semaine', 'Semana', 'Woche', 'أسبوع', 'ہفتہ', 'सप्ताह', '周'],
    ['Month', 'Mois', 'Mes', 'Monat', 'شهر', 'مہینہ', 'महीना', '月'],
    ['Today', 'Aujourd\'hui', 'Hoy', 'Heute', 'اليوم', 'آج', 'आज', '今天'],
    ['Find a time', 'Trouver un créneau', 'Buscar un horario', 'Zeit finden', 'ابحث عن وقت', 'وقت تلاش کریں', 'समय खोजें', '查找时间'],
    ['Save', 'Enregistrer', 'Guardar', 'Speichern', 'حفظ', 'محفوظ کریں', 'सहेजें', '保存'],
    ['Cancel', 'Annuler', 'Cancelar', 'Abbrechen', 'إلغاء', 'منسوخ کریں', 'रद्द करें', '取消'],
    ['Delete', 'Supprimer', 'Eliminar', 'Löschen', 'حذف', 'حذف کریں', 'हटाएं', '删除'],
    ['Edit', 'Modifier', 'Editar', 'Bearbeiten', 'تعديل', 'ترمیم کریں', 'संपादित करें', '编辑'],
    ['Close', 'Fermer', 'Cerrar', 'Schließen', 'إغلاق', 'بند کریں', 'बंद करें', '关闭'],
    ['Search', 'Rechercher', 'Buscar', 'Suchen', 'بحث', 'تلاش کریں', 'खोजें', '搜索'],
    ['Refresh', 'Actualiser', 'Actualizar', 'Aktualisieren', 'تحديث', 'تازہ کریں', 'ताज़ा करें', '刷新'],
    ['Connect', 'Connecter', 'Conectar', 'Verbinden', 'اتصال', 'منسلک کریں', 'कनेक्ट करें', '连接'],
    ['Reconnect', 'Reconnecter', 'Reconectar', 'Neu verbinden', 'إعادة الاتصال', 'دوبارہ منسلک کریں', 'फिर से कनेक्ट करें', '重新连接'],
    ['Disconnect', 'Déconnecter', 'Desconectar', 'Trennen', 'قطع الاتصال', 'منقطع کریں', 'डिस्कनेक्ट करें', '断开连接'],
    ['Run', 'Exécuter', 'Ejecutar', 'Ausführen', 'تشغيل', 'چلائیں', 'चलाएं', '运行'],
    ['Play', 'Lire', 'Reproducir', 'Abspielen', 'تشغيل', 'چلائیں', 'चलाएं', '播放'],
    ['Pause', 'Pause', 'Pausa', 'Pause', 'إيقاف مؤقت', 'روکیں', 'रोकें', '暂停'],
    ['Queue', 'File d\'attente', 'Cola', 'Warteschlange', 'قائمة الانتظار', 'قطار', 'कतार', '队列'],
    ['Actions', 'Actions', 'Acciones', 'Aktionen', 'الإجراءات', 'کارروائیاں', 'कार्रवाइयां', '操作'],
    ['All', 'Tout', 'Todo', 'Alle', 'الكل', 'سب', 'सभी', '全部'],
    ['Events', 'Événements', 'Eventos', 'Termine', 'الأحداث', 'تقریبات', 'कार्यक्रम', '事件'],
    ['Chats', 'Discussions', 'Chats', 'Chats', 'المحادثات', 'چیٹس', 'चैट', '聊天'],
    ['Memories', 'Souvenirs', 'Recuerdos', 'Erinnerungen', 'الذكريات', 'یادیں', 'यादें', '记忆'],
    ['Apps', 'Applications', 'Aplicaciones', 'Apps', 'التطبيقات', 'ایپس', 'ऐप्स', '应用'],
    ['Pages', 'Pages', 'Páginas', 'Seiten', 'الصفحات', 'صفحات', 'पृष्ठ', '页面'],
    ['Conversations', 'Conversations', 'Conversaciones', 'Unterhaltungen', 'المحادثات', 'گفتگو', 'बातचीत', '对话'],
    ['No matches', 'Aucun résultat', 'Sin resultados', 'Keine Treffer', 'لا توجد نتائج', 'کوئی نتیجہ نہیں', 'कोई परिणाम नहीं', '没有结果'],
    ['Suggested for you', 'Suggestions pour vous', 'Sugerencias para ti', 'Vorschläge für dich', 'مقترحات لك', 'آپ کے لیے تجاویز', 'आपके लिए सुझाव', '为你推荐'],
    ['Weather', 'Météo', 'Clima', 'Wetter', 'الطقس', 'موسم', 'मौसम', '天气'],
    ['News', 'Actualités', 'Noticias', 'Nachrichten', 'الأخبار', 'خبریں', 'समाचार', '新闻'],
    ['System', 'Système', 'Sistema', 'System', 'النظام', 'سسٹم', 'सिस्टम', '系统'],
    ['Upcoming tasks', 'Tâches à venir', 'Próximas tareas', 'Anstehende Aufgaben', 'المهام القادمة', 'آنے والے کام', 'आगामी कार्य', '即将到来的任务'],
    ['Coming up', 'À venir', 'Próximamente', 'Demnächst', 'قادم', 'آنے والا', 'आने वाला', '即将到来'],
    ['Recent documents', 'Documents récents', 'Documentos recientes', 'Neueste Dokumente', 'المستندات الأخيرة', 'حالیہ دستاویزات', 'हाल के दस्तावेज़', '最近的文档'],
    ['Recent conversations', 'Conversations récentes', 'Conversaciones recientes', 'Neueste Unterhaltungen', 'المحادثات الأخيرة', 'حالیہ گفتگو', 'हाल की बातचीत', '最近的对话'],
    ['Smart home', 'Maison connectée', 'Hogar inteligente', 'Smart Home', 'المنزل الذكي', 'اسمارٹ ہوم', 'स्मार्ट होम', '智能家居'],
    ['Make study set', 'Créer un ensemble', 'Crear conjunto', 'Lernset erstellen', 'إنشاء مجموعة', 'سیٹ بنائیں', 'सेट बनाएं', '创建学习集'],
    ['Build hard test', 'Créer un test difficile', 'Crear examen difícil', 'Schweren Test erstellen', 'إنشاء اختبار صعب', 'مشکل ٹیسٹ بنائیں', 'कठिन परीक्षा बनाएं', '生成难题测试'],
    ['Know it', 'Je sais', 'Lo sé', 'Kann ich', 'أعرفها', 'مجھے آتا ہے', 'मुझे आता है', '我会了'],
    ['Still learning', 'En apprentissage', 'Aún aprendiendo', 'Noch am Lernen', 'ما زلت أتعلم', 'ابھی سیکھ رہا ہوں', 'अभी सीख रहा हूं', '还在学习'],
    ['Shuffle', 'Mélanger', 'Mezclar', 'Mischen', 'خلط', 'ترتیب بدلیں', 'फेरबदल', '随机'],
    ['Check', 'Vérifier', 'Comprobar', 'Prüfen', 'تحقق', 'جانچیں', 'जांचें', '检查'],
    ['Continue', 'Continuer', 'Continuar', 'Weiter', 'متابعة', 'جاری رکھیں', 'जारी रखें', '继续'],
    ['Submit test', 'Soumettre le test', 'Enviar examen', 'Test abgeben', 'إرسال الاختبار', 'ٹیسٹ جمع کرائیں', 'परीक्षा जमा करें', '提交测试'],
    ['Play again', 'Rejouer', 'Jugar de nuevo', 'Nochmal spielen', 'العب مرة أخرى', 'دوبارہ کھیلیں', 'फिर से खेलें', '再玩一次'],
    ['Message Nexus…  (Shift+Enter for a new line)', 'Écrire à Nexus…  (Maj+Entrée pour une nouvelle ligne)', 'Escribe a Nexus…  (Mayús+Intro para una línea nueva)', 'Nachricht an Nexus…  (Umschalt+Eingabe für neue Zeile)', 'راسل Nexus…  (Shift+Enter لسطر جديد)', 'Nexus کو پیغام…  (نئی لائن کے لیے Shift+Enter)', 'Nexus को संदेश…  (नई पंक्ति के लिए Shift+Enter)', '给 Nexus 发消息…  (Shift+Enter 换行)'],
    ['Search apps, documents, tasks, chats…', 'Rechercher applications, documents, tâches, discussions…', 'Buscar aplicaciones, documentos, tareas, chats…', 'Apps, Dokumente, Aufgaben, Chats suchen…', 'ابحث في التطبيقات والمستندات والمهام والمحادثات…', 'ایپس، دستاویزات، کام، چیٹس تلاش کریں…', 'ऐप्स, दस्तावेज़, कार्य, चैट खोजें…', '搜索应用、文档、任务、聊天…']
];
const TEXT_ATTRIBUTES = ['placeholder', 'aria-label', 'title'];
let activeDictionary = null;
let languageObserver = null;
// Originals are kept so switching language, or back to English, always starts from the source text.
const originalText = new WeakMap();
const originalAttributes = new WeakMap();

function dictionaryFor(language) {
    const column = LANGUAGE_ORDER.indexOf(language);
    return column < 0 ? null : new Map(TRANSLATIONS.map(row => [row[0], row[column + 1]]));
}
function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName) || parent.closest('#chat-box,.doc-preview,.search-results .search-item,.flashcard,.test-question')) return;
    const current = node.nodeValue;
    const saved = originalText.get(node);
    // Text that no longer matches what was last shown was changed by the app, so it is the new source.
    const base = saved && saved.shown === current ? saved.source : current;
    const translated = activeDictionary?.get(base.trim());
    const shown = translated || base;
    if (translated || saved) originalText.set(node, { source: base, shown });
    if (current !== shown) node.nodeValue = shown;
}
function translateAttributes(element) {
    const saved = originalAttributes.get(element) || {};
    for (const name of TEXT_ATTRIBUTES) {
        const current = element.getAttribute(name);
        if (current === null) continue;
        const base = saved[name]?.shown === current ? saved[name].source : current;
        const translated = activeDictionary?.get(base.trim());
        const shown = translated || base;
        if (translated || saved[name]) { saved[name] = { source: base, shown }; originalAttributes.set(element, saved); }
        if (current !== shown) element.setAttribute(name, shown);
    }
}
function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) { translateTextNode(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) { if (node.nodeType === Node.TEXT_NODE) translateTextNode(node); else translateAttributes(node); }
}
function setInterfaceLanguage(language) {
    document.documentElement.lang = LANGUAGE_TAGS[language] || 'en';
    const next = dictionaryFor(language);
    if (next === activeDictionary || (!next && !activeDictionary)) return;
    activeDictionary = next;
    translateTree(document.body);
    if (activeDictionary && !languageObserver) {
        languageObserver = new MutationObserver(records => {
            if (!activeDictionary) return;
            for (const record of records) {
                if (record.type === 'attributes') translateAttributes(record.target);
                else if (record.type === 'characterData') translateTextNode(record.target);
                else record.addedNodes.forEach(translateTree);
            }
        });
        languageObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TEXT_ATTRIBUTES });
    }
}
