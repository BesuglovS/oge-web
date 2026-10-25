# Архитектура проекта oge-web

## Обзор

Статическое веб-приложение для подготовки к ОГЭ по информатике. Содержит
интерактивные задания с автоматической проверкой, теорию, PWA-режим и серверную
песочницу Python для задания 16.

## Структура проекта

```
oge-web/
├── oge.html                   # Главная (выбор заданий + сводка прогресса)
├── oge{N}.html                # Интерактивные задания (1–12, 15, 16)
├── oge{N}-t.html              # Теория к каждому заданию
├── oge131-t.html, oge132-t.html, oge14-t.html  # Задания 13.1/13.2/14 — только теория
├── oge4-path.html             # Альтернативный тренажёр задания 4
├── run_python.php             # Серверная песочница (Python, задание 16)
├── assets/                    # styles.css, favicon.svg, иконки
├── data/oge7.json             # Данные задания 7 (JSON)
├── files/                     # Задание11-12.zip, files/oge15/ (данные задания 15)
├── js/                        # metrika.js, progress.js, progress-client.js,
│                              # progress-sync.js, tracking-client.js
├── git/index.php              # Web-UI self-hosted git-репозиториев
├── manifest.json, sw.js       # PWA (манифест + service worker)
├── offline.html, 404.html     # Офлайн-страница и страница 404
├── deploy.ps1                 # Деплой (tar + ssh)
├── oge.nayanovaacademy.ru     # nginx-конфиг (tracked, деплоится отдельно)
├── LICENSE                    # MIT
└── README.md
```

## Клиентская архитектура

Каждое задание — самостоятельный HTML-файл с inline CSS-подключением к общему
`assets/styles.css` и inline JavaScript.

```
oge.html (навигация + прогресс)
├── oge1.html … oge12.html      (интерактив)
├── oge131-t / oge132-t / oge14-t (только теория)
├── oge15.html                  (интерпретатор КуМир, задание 15)
└── oge16.html                  (Python-песочница, задание 16)
```

### Типы интерактива

| Технология | Задания |
|------------|---------|
| Ввод текста | oge1, oge2, oge3, oge6, oge8, oge9, oge10, oge11, oge12 |
| Drag-and-drop | oge7 |
| Интерактивная модель | oge4, oge4-path |
| Выбор ответа | oge5 |
| Интерпретатор (КуМир) | oge15 |
| Серверный запуск Python | oge16 |

## Система прогресса

Данные заданий захардкожены в JS (или загружаются из `data/`/`files/`).
Прогресс хранится локально и синхронизируется с порталом Академии.

| Ключ localStorage | Назначение | Модуль |
|-------------------|-----------|--------|
| `oge-progress` | Пройденные задания и лучшие баллы | `js/progress.js` |
| `nayanova-progress` | Зеркало прогресса для портала | `js/progress-client.js` |
| `nayanova-progress:outbox` | Очередь неотправленных записей | `js/progress-client.js` |

`TASKS` в `js/progress.js` и `js/progress-sync.js` содержит 14 интерактивных
заданий (13.1/13.2/14 исключены — у них нет интерактивных страниц). Скрипты
`progress-client.js`/`progress-sync.js` подключены на всех интерактивных
страницах, `tracking-client.js` — на всех страницах (включая теорию, чтобы
портал видел активность). `OGEProgress.save()` диспатчит событие
`oge-progress-saved`, и `progress-sync.js` сразу отправляет прогресс на портал,
не дожидаясь возврата на лендинг.

## PWA

- `manifest.json` подключается на всех страницах (`<link rel="manifest">`).
- `sw.js` (`CACHE_NAME='oge-web-v19'`) кэширует статику и данные задания 15;
  HTML — network-first с фолбэком на кэш и `offline.html`; остальные ассеты —
  cache-first. Большие архивы (`files/*.zip`) не кэшируются.
- При изменении списка ассетов поднять `CACHE_NAME`.

## Редактор кода (oge16.html)

`js/code-editor.js` — overlay-редактор: прозрачная textarea поверх слоя с
подсветкой Python и номерами строк. Ширина/высота слоя, `tab-size` и переносы
строк синхронизированы с textarea, иначе каретка «уезжает» от текста.
Горячие клавиши: Tab/Shift+Tab — отступ, Enter — автоотступ (после `:`),
автозакрытие скобок и кавычек, Ctrl+/ — комментарий, Ctrl+D — дублировать
строку, Ctrl+Enter — запустить проверку, Esc — выйти из редактора.
Правки идут через `execCommand`, поэтому Ctrl+Z их отменяет.
Черновик кода хранится в `localStorage` (`oge16-draft-<id>`).


## Серверная песочница (run_python.php)

Задание 16 выполняет Python-код на сервере:

```
HTTP POST (code, test_input, expected_output)
    │
    ▼
run_python.php
    ├── POST-only, лимит 20 КБ кода, timeout 5 с
    ├── rate-limit: nginx `20r/s burst=60` + файловый 600/мин по IP
    ├── pre-фильтры: белый список модулей + запрет опасных конструкций
    ├── wrapper: exec(compile(base64-код)) в namespace с усечёнными builtins
    │   (нет open/eval/exec/getattr; import — только по белому списку)
    ├── изоляция процесса: root-хелпер /usr/local/sbin/sandbox-python.run
    │   (unshare net+pid, пользователь sandbox, prlimit RLIMIT_AS/CPU);
    │   без хелпера на Linux — fail-closed (503)
    └── JSON-ответ {output, expected, matched, error, timeout}
```

Разрешённые модули: `math`, `random`, `datetime`, `decimal`, `fractions`,
`string`, `re`, `collections`, `itertools`, `functools`, `operator`, `json`,
`csv`.

## Деплой

`deploy.ps1` читает `.env` (SSH-параметры), пакует проект `tar`-ом с
исключениями (`.git`, `.env`, `deploy.ps1`, документация, nginx-конфиг, `p`)
и разворачивает по SSH **атомарно**: новый релиз распаковывается в
`releases/<ts>-<pid>`, серверные файлы `git/` переносятся без перезаписи,
выполняется smoke-check, затем `public` — симлинк на новый релиз (замена
через `mv -T`). При ошибке live-версия не меняется; старые релизы хранятся
(KEEP=5) для отката. nginx-конфиг деплоится отдельным шагом через
`sudo /usr/local/sbin/deploy-nginx.sh`. Откат — `.\deploy.ps1 -Rollback`
(предыдущий релиз) или `-Rollback -Release <имя>`; симлинк переключается
атомарно.

## Дизайн-система

Стили страниц — `assets/styles.css`; токены `--na-*` заданы inline в
`404.html`/`offline.html` (неиспользуемый `assets/design-tokens.css` удалён):

- Фон: тёмный градиент.
- Карточки: полупрозрачные с градиентными бордерами.
- Нумерация заданий: цветные бейджи с градиентами.
- Анимации: hover-эффекты, плавные переходы.
- Доступность: skip-link, `aria-live` для прогресса, focus-стили.
