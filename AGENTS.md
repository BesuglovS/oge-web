# AGENTS.md — Инструкции для ИИ-ассистентов

Интерактивное приложение для подготовки к **ОГЭ по информатике** (16 типов заданий).
Чистый статический HTML5 + inline CSS/JS (каждая страница самодостаточна), PWA, PHP-песочница
для задания 16. Русский язык. Прод: `https://oge.nayanovaacademy.ru`.

## ⚠️ Критические правила

1. **Service Worker — главная ловушка деплоя.** `sw.js` (`CACHE_NAME='oge-web-v1'`) предкэширует жёсткий
   список `ASSETS` (все `ogeN.html`, `ogeN-t.html`, `oge4-path.html`, `data/oge7.json`, `oge7.txt`, `js/metrika.js`, `js/progress.js`, `manifest.json`, `/`).
   При добавлении/изменении ассета: добавить в `ASSETS` **и поднять `CACHE_NAME`** (`v1` → `v2`), иначе пользователи вечно видят старый кэш.
2. **`run_python.php` — безопасность критична.** Песочница задания 16: POST-only, лимит 20 КБ кода,
   белый список модулей, блокирующие regex-паттерны (`__import__`, `eval(`, `os`, `subprocess`, `sys`,
   `open(`, ...), проверка `import` по белому списку, `timeout 5`, сравнение вывода после нормализации пробелов.
   **Не ослаблять проверки**; `/usr/bin/python3` захардкожен. Реальный песочницей это НЕ является — defense-in-depth.
3. **`oge{N}.html` — интерактив, `oge{N}-t.html` — теория** (`t` = теория, НЕ teacher).
   Задания 13.1/13.2/14 имеют только теорию (`oge131-t.html`, `oge132-t.html`, `oge14-t.html`) — интерактивных нет.
4. **Прогресс**: задания пишут `localStorage['oge-progress']` через `OGEProgress` (`js/progress.js`).
   `TASKS = ['oge1'..'oge12','oge15','oge16']` в **обоих** `js/progress.js` и `js/progress-sync.js`
   (13/14 намеренно исключены, есть TODO). При добавлении интерактивного задания править оба файла.
   Серверный синк (`progress-client/sync/tracking-client`) — только на `oge.html`.
5. **Задание 15 — полный Кумир-интерпретатор на JS** (~2400 строк в `oge15.html`): лексер, парсер
   (`parseProgram/parseWhile/parseIf`), step/run/pause, поле-канвас, сравнение закрашенных клеток с
   `files/oge15/oge-15-2026-e-NN.json`. Парсер намеренно толерантен (пропускает неизвестные слова).
6. **`.env` закоммичен** (SSH-параметры с реальными значениями, путь к ключу `../ssh-private.key`).
   Не печатать значения, не менять без необходимости. Восстановить `.gitignore` при возможности.
7. **Два zip в `files/`** (`Задание11-12.zip` и его mojibake-двойник) — байт-идентичны (одинаковый MD5),
   артефакт кодировки git. Не удалять/переименовывать бездумно; HTML ссылается только на `Задание11-12.zip`.
8. **`p/` (Leaflet-маршруты) и `git/` (self-hosted git-UI) не исключены из деплоя** — часть сайта,
   хотя со страниц заданий не линкуются. `overpass-proxy.php` отключает проверку SSL — потенциально
   открытый прокси; учитывать при харденинге.
9. **Вся страницы с UTF-8 BOM** — сохранять кодировку. PowerShell-консоль показывает mojibake (codepage) — работать UTF-8-инструментами.
10. **`_orig_oge2.css`** — пустой легаси-файл (3 байта), можно оставить.
11. **Нет `.htaccess`, `sitemap.xml`, `robots.txt`, `.gitignore`** (доки упоминают `.htaccess` — его нет).
    Реальная конфигурация — nginx-файл `oge.nayanovaacademy.ru` (untracked).

## 🔧 Команды

```bash
python -m http.server 8000   # локальный dev-сервер (для полной функциональности нужен PHP: run_python.php, git/, p/)
php -S 127.0.0.1:8080        # локально с PHP (задание 16)
.\deploy.ps1 -DryRun         # сухой прогон
.\deploy.ps1                 # деплой
```

Сборки, тестов, CI — **нет**; проверка вручную (генерация задач, drag-drop, офлайн, песочница).

## 🏗 Структура

```
oge.html               # лендинг-навигация (карточки заданий) + progress/tracking скрипты
oge{N}.html            # интерактивные задания 1–16 (inline CSS/JS, данные в JS-объектах)
oge{N}-t.html          # теория для каждого задания; oge131-t / oge132-t / oge14-t — только теория
oge4-path.html         # доп. тренажёр: кратчайший путь в графе
oge7.txt               # легаси-данные задания 7; data/oge7.json — JSON-версия (в синхроне)
run_python.php         # Python-песочница (задание 16) — СМ. крит. правило 2
assets/styles.css      # общий стиль (организован по секциям и постранично); design-tokens.css НЕ подключён
js/metrika.js          # Yandex.Metrika 107219928 + track* хелперы
js/progress.js, progress-client.js, progress-sync.js, tracking-client.js
files/Задание11-12.zip            # скачиваемый архив для заданий 11/12 (34 МБ)
files/oge15/                     # tasks.json + оge-15-2026-NN.json (поля) + e-NN.json (ожидаемые клетки) + .kum (решения)
p/                                 # маршрутное приложение (Leaflet+OSRM+Overpass proxy)
git/index.php                      # web-UI self-hosted git-репозиториев
manifest.json, sw.js, offline.html, 404.html, LICENSE
deploy.ps1, oge.nayanovaacademy.ru (nginx, untracked)
```

## 💻 Конвенции кода

- **HTML**: `<!doctype html>`, `lang="ru"`, UTF-8 BOM, favicon `assets/favicon.svg`, theme-color `#764ba2`,
  meta description/canonical/OG, Yandex.Metrika. Тело: `.container role="main"` → `.nav-links` →
  `.progressContainer` → `#taskCard` → `hint-box`/`solution-box` → `task-nav` → `quick-nav`. Skip-link для a11y.
- Body-классы для тем: `body-dark` (oge7/8), `body-teal oge2`, `body-red-purple` (oge131-t), `body-blue-indigo` (oge132-t), `body-center` (oge.html).
- **JS**: inline `<script>`, vanilla (смесь ES5 и `const`/`let`/стрелок), глобальные функции
  (`checkAnswer`, `nextTask`, `showHint`, `showSolution`, `generateTask`), `currentTask` — сгенерированный
  ответ; текстовые ответы сравниваются case-insensitive. Хуки: `trackTaskStart('ogeN')`, `OGEProgress.save(...)`
  под `typeof`-guard'ами.
- **CSS**: переменные `--color-primary: #667eea`, `--color-secondary: #764ba2`, классы `.task-card`,
  `.btn`, `.answer-input`, `.theory-section`, `.formula-box`, `.warning-box`.
- Контент и комментарии — **русский**.

## 🚀 Деплой (`deploy.ps1`)

1. `.env` → SSH-переменные; `icacls` ключа.
2. `tar` (без `.git`, `.gitignore`, `.env`, `deploy.ps1`, nginx-конфига, IDE/лог-файлов) → SSH.
3. Удалённо: удаляет всё **кроме `p/` и `git/`** в целевой директории → распаковка.
4. Деплой nginx-конфига + `nginx -t && systemctl reload nginx`.

Требования сервера: nginx + PHP 8.1-FPM, `/usr/bin/python3`, `timeout`, root
`/var/www/oge.nayanovaacademy.ru/public/`. Nginx: `try_files $uri $uri/ $uri.php =404`, static `immutable 30d`,
`no-cache` для `/sw.js` и `/js/tracking-client.js`, dotfiles deny.

## 🔒 Безопасность

- `run_python.php`: не ослаблять regex/белый список; изменения — security-sensitive, тестировать тщательно.
- `overpass-proxy.php` с `verify_peer=false` — потенциальный открытый прокси; при харденинге ограничивать.
- `git/index.php` раскрывает внутренности сервера (список репозиториев) — намеренно задеплоен, не удалять без понимания.
- `.env` и `G:\WebSites\na\ssh-private.key` — никогда не печатать/коммитить.
- Деплой сохраняет только `p/` и `git/`; всё остальное на сервере удаляется.