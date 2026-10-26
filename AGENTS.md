# AGENTS.md — Инструкции для ИИ-ассистентов

Интерактивное приложение для подготовки к **ОГЭ по информатике** (16 типов заданий).
Чистый статический HTML5 + inline CSS/JS (каждая страница самодостаточна), PWA, PHP-песочница
для задания 16. Русский язык. Прод: `https://oge.nayanovaacademy.ru`.

## ⚠️ Критические правила

1. **Service Worker — главная ловушка деплоя.** `sw.js` (`CACHE_NAME='oge-web-v25'`) предкэширует жёсткий
   список `ASSETS` (все `ogeN.html`, `ogeN-t.html`, `oge4-path.html`, `assets/styles.css`, `assets/favicon.svg`, `assets/icon-*.png`, `favicon.ico`, `data/oge7.json`, `js/*.js`, `manifest.json`, `offline.html`, `404.html`, `/files/oge15/*.json`, `/`).
   При добавлении/изменении ассета: добавить в `ASSETS` **и поднять `CACHE_NAME`** (`v24` → `v25`), иначе пользователи вечно видят старый кэш.
   Ассеты добавляются по одному (`fetch(..., {cache:'reload'})` + `cache.put`), чтобы один 404 не ломал установку SW.
2. **`run_python.php` — безопасность критична.** Песочница задания 16: POST-only, лимит 20 КБ кода,
   белый список модулей, блокирующие regex-паттерны (`__import__`, `eval(`, `os`, `subprocess`, `sys`,
   `open(`, `breakpoint`, `__class__`, `__subclasses__`, `__globals__`, ...), проверка `import` по белому списку, `timeout 5`, сравнение вывода после нормализации пробелов (числа — с допуском).
   **Не ослаблять проверки**; `/usr/bin/python3` захардкожен. Без root-хелпера на Linux песочница
   **fail-closed** (503), dev-fallback — только Windows или `SANDBOX_ALLOW_FALLBACK=1`.
   Есть пакетный режим (`tests` = JSON-массив `{input, expected}`, до 12 тестов, ≤200 КБ данных,
   бюджет 20 с): код проверяется и оборачивается один раз, песочница запускается на каждый тест.
   Ошибка/таймаут останавливают прогон, остальные тесты помечаются `skipped`.
   Реальный песочницей это НЕ является — defense-in-depth.
3. **`oge{N}.html` — интерактив, `oge{N}-t.html` — теория** (`t` = теория, НЕ teacher).
   Задания 13.1/13.2/14 имеют только теорию (`oge131-t.html`, `oge132-t.html`, `oge14-t.html`) — интерактивных нет.
4. **Прогресс**: задания пишут `localStorage['oge-progress']` через `OGEProgress` (`js/progress.js`).
   `TASKS = ['oge1'..'oge12','oge15','oge16']` в **обоих** `js/progress.js` и `js/progress-sync.js`
   (13/14 намеренно исключены, есть TODO). При добавлении интерактивного задания править оба файла.
   `OGEProgress.save()` шлёт событие `oge-progress-saved`; `progress-sync.js` слушает его и сразу
   отправляет прогресс на портал. Скрипты `progress-client/progress-sync` подключены на всех
   интерактивных страницах, `tracking-client` — на всех страницах (включая теорию).
5. **Задание 15 — Кумир-интерпретатор на JS** (~2400 строк в `oge15.html`): лексер, парсер
   (`parseProgram/parseWhile/parseFor/parseIf`), `нц пока`, `нц N раз`, `если`, step/run/pause, поле-канвас,
   сравнение закрашенных клеток с `files/oge15/oge-15-2026-e-NN.json`. КуМир **регистронезависим**
   (слова нормализуются в лексере); `нц для` поддерживается в частом случае — числовые границы
   и шаг, переменная цикла в теле не используется (иначе понятная ошибка). Парсер
   намеренно толерантен (пропускает неизвестные слова, но логирует их).
   Есть **генератор случайных обстановок** (`js/oge15-gen.js` + автогенерируемый `js/oge15-ref.js`
   с эталонными решениями). Генератор строит случайную геометрию по семейству задачи, а эталон
   закраски вычисляет «оракулом» — прогоном соответствующего `.kum`. `js/oge15-ref.js` нужно
   перегенерировать после правки `.kum`: `node tools/gen-oge15-ref.mjs`.
6. **`.env` отслеживается git** (по решению владельца; ранее был исключён через `git rm --cached`, теперь возвращён).
   Содержит SSH-параметры (путь к ключу `../ssh-deploy.key`). **Значения не печатать и не логировать.**
   `deploy.ps1` исключает `.env` из архива — на сервер он не попадает. Хранение секретов в публичном
   репозитории — осознанный риск: при утечке сменить ключ и параметры деплоя.
7. **Один архив в `files/`** — `Задание11-12.zip`. Дубликат с mojibake-именем удалён (2026-10-25),
   архив перепакован с флагом UTF-8 (bit 11), чтобы Проводник/`Expand-Archive` не превращали
   `Классика/Проза` в кракозябры. **Не перепаковывать без флага UTF-8** и не менять имена папок:
   на них ссылаются задания 11/12.
8. **`git/` (self-hosted git-UI) не исключён из деплоя** — часть сайта,
   хотя со страниц заданий не линкуется. Каталог `p/` (Leaflet-маршруты)
   УДАЛЁН (сентябрь 2026); `deploy.ps1` исключает его из tar и стирает на сервере.
9. **Вся страницы с UTF-8 BOM** — сохранять кодировку. PowerShell-консоль показывает mojibake (codepage) — работать UTF-8-инструментами.
10. **`_orig_oge2.css`** — пустой легаси-файл (3 байта) удалён.
11. **Нет `.htaccess`** (доки упоминают `.htaccess` — его нет). Есть `.gitignore`, `robots.txt`, `sitemap.xml`.
    Реальная конфигурация — nginx-файл `oge.nayanovaacademy.ru` (**отслеживается git**, деплоится отдельным шагом).

## 🔧 Команды

```bash
python -m http.server 8000   # локальный dev-сервер (нужен PHP: run_python.php, git/)
php -S 127.0.0.1:8080        # локально с PHP (задание 16)
.\deploy.ps1 -DryRun         # сухой прогон
.\deploy.ps1                 # деплой
```

Сборки нет. Есть статические проверки: `node tools/check-site.mjs` (ссылки, canonical,
sw-ассеты вместе с 40 файлами задания 15, иконки, head-теги, BOM, sitemap, noindex, а также
разметка/доступность: один `h1`, уникальные `id`, `alt` у картинок, `type` у кнопок,
`rel="noopener"`, подключение скриптов аналитики/прогресса и бюджет размера файлов),
`node tools/check-css.mjs` (баланс скобок, мёртвые правила, точные дубли, полностью
перекрытые правила и реестр `tools/css-known-conflicts.json` — сейчас конфликтов 0;
`--merge` объединяет правила одного селектора, `--fix` удаляет дубли, `--update`
обновляет реестр),
`node tools/check-data.mjs` (577 тестов задания 16, 60 уникальных id; ответы генераторов
заданий 1 (размер текста: цена символа × (длина+2) = изменение, ответ есть в списке и
однозначен), 2 (условие Фано и единственность расшифровки), 3 (условие разбирается из
текста, ответ — независимый перебор), 4 (кратчайший путь — полный перебор путей),
5 (программа-ответ прогоняется независимой реализацией команд, для «определи b» проверяется
ещё и единственность b), 6 (пересчёт по условию программы), 7 (URL собирается из полей задачи
и разбирается как настоящий адрес), 8 (формула включений-исключений,
5 типов), 9 (пути в графе — полный перебор, включая «через/не через вершину»)
и 10 (ответ пересчитывается по тексту задачи, который видит ученик); сверка
`.kum`↔`e-*.json` и синхронность `js/oge15-ref.js`↔`.kum`, структура `tasks.json`;
генератор задания 15; структура `data/oge7.json`; ответы задания 12 по архиву),
`node tools/check-sandbox.mjs` (реальный `php -S` + POST-тесты песочницы: успех, числовой
допуск, строки, запрещённый импорт, timeout, GET 405),
`node tools/check-theory.mjs` (примеры кода в теории: Python-блоки компилируются,
программы КуМира разбираются настоящим парсером тренажёра),
`node tools/check-oge11-archive.mjs` (ответы задания 11 сверяются с текстом произведений
в `files/Задание11-12.zip`: папка и файл берутся из подсказки, поддерживаются
`.txt/.htm/.html/.rtf/.docx`) и `php -l run_python.php git/index.php`;
они же запускаются в CI (`.github/workflows/checks.yml`). Вне CI (нужен интернет):
`node tools/check-links.mjs` — внешние ссылки на sister-сайты. Перед коммитом правок
страниц: `node tools/update-sitemap.mjs` (lastmod = дата последнего коммита файла).

## 🏗 Структура

```
oge.html               # лендинг-навигация (карточки заданий) + progress/tracking скрипты
oge{N}.html            # интерактивные задания 1–16 (inline CSS/JS, данные в JS-объектах)
oge{N}-t.html          # теория для каждого задания; oge131-t / oge132-t / oge14-t — только теория
oge4-path.html         # доп. тренажёр: кратчайший путь в графе
data/oge7.json         # данные задания 7 (единственный источник; легаси oge7.txt удалён)
run_python.php         # Python-песочница (задание 16) — СМ. крит. правило 2
php-fpm-opcache.ini    # opcache.revalidate_path=1 для симлинк-деплоя (копия серверной)
assets/styles.css      # общий стиль (организован по секциям и постранично)
js/metrika.js          # Yandex.Metrika 107219928 + track* хелперы
js/code-editor.js      # overlay-редактор кода для задания 16 (подсветка, номера строк, отступы)
js/progress.js, progress-client.js, progress-sync.js, tracking-client.js
js/oge15-gen.js        # генератор случайных обстановок задания 15
js/oge15-ref.js        # АВТОГЕНЕРАЦИЯ: эталонные .kum, встроенные для «оракула» генератора
files/Задание11-12.zip            # скачиваемый архив для заданий 11/12 (34 МБ, имена в UTF-8 с флагом bit 11)
files/oge15/                     # tasks.json + оge-15-2026-NN.json (поля) + e-NN.json (ожидаемые клетки) + .kum (решения)
git/index.php                      # web-UI self-hosted git-репозиториев
tools/check-site.mjs               # статические проверки (ссылки, SW, SEO, BOM)
tools/check-css.mjs                # CSS-аудит + реестр известных конфликтов
tools/css-utils.mjs                # общий парсер CSS
tools/css-known-conflicts.json     # реестр конфликтов page-секций (сейчас пусто)
tools/visual-baseline.mjs          # снимок вычисленных стилей (регрессия CSS, нужен Chrome)
tools/browser-smoke.mjs            # smoke-тест в реальном Chrome: ответы, песочница, CSP (нужен Chrome)
tools/update-sitemap.mjs           # lastmod в sitemap.xml по датам коммитов (запускать перед коммитом правок страниц)
tools/check-data.mjs               # проверки данных заданий 1–10, 12, 15, 16 (нужен python 3)
tools/check-sandbox.mjs            # интеграционный тест run_python.php (php + python 3)
tools/check-theory.mjs             # примеры кода в теории: Python + КуМир (нужен python 3)
tools/check-links.mjs              # внешние ссылки (вне CI, нужен интернет)
tools/check-oge11-archive.mjs      # ответы задания 11 по текстам в архиве (нужен python 3)
tools/gen-oge15-ref.mjs            # пересборка js/oge15-ref.js из .kum
manifest.json, sw.js, offline.html, 404.html, LICENSE
deploy.ps1, oge.nayanovaacademy.ru (nginx, tracked)
```

## 💻 Конвенции кода

- **HTML**: `<!doctype html>`, `lang="ru"`, UTF-8 BOM, favicon `assets/favicon.svg`, theme-color `#7f5468`,
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

1. `.env` → SSH-переменные (`DEPLOY_SSH_USER=deploy`, ключ `../ssh-deploy.key`); `icacls` ключа.
2. `tar` (без `.git`, `.gitignore`, `.env`, `deploy.ps1`, документации, nginx-конфига, `p`, `tools`, `.github`, IDE/лог-файлов) → загрузка скрипта деплоя по SSH, затем tar на stdin.
3. **Атомарный деплой:** новый релиз распаковывается в `releases/<timestamp>-<pid>`,
   серверные файлы `git/` добавляются в него без перезаписи (`cp -a -n`), выполняется
   smoke-check (`oge.html`, `sw.js`, `version.json`, `js/progress.js`, `js/oge15-ref.js`,
   `files/*.zip`), затем `public` — **симлинк** на новый релиз (атомарная замена через
   `mv -T`). При любой ошибке live не трогается; старые релизы хранятся (KEEP=5)
   для отката. Первичная миграция real-dir `public` → `releases/initial-*` + симлинк.
4. Деплой nginx-конфига через `sudo -n /usr/local/sbin/deploy-nginx.sh oge.nayanovaacademy.ru`
   (sudoers deploy-nginx; хелпер валидирует nginx -t и откатывает конфиг при ошибке).

**⚠️ opcache и симлинк.** `public` — симлинк, а opcache по умолчанию
(`revalidate_path=0`) запоминает realpath и после переключения релиза продолжает
выполнять **старый** PHP-файл (`run_python.php`, `git/index.php`). На сервере
установлен `/etc/php/8.1/fpm/conf.d/99-oge-opcache.ini` (`opcache.revalidate_path=1`,
`revalidate_freq=0`), копия — `php-fpm-opcache.ini` в репозитории. `deploy.ps1`
после деплоя сверяет заголовок `X-Sandbox-Build` с локальным хешем `run_python.php`
и предупреждает, если PHP-код не обновился.

**Откат:** `.\deploy.ps1 -Rollback` переключает `public` на предыдущий релиз,
`.\deploy.ps1 -Rollback -Release <имя>` — на указанный. Переключение симлинка
атомарное, reload nginx не требуется.

Требования сервера: nginx + PHP 8.1-FPM, root `/var/www/oge.nayanovaacademy.ru/public/`.
Nginx: `try_files $uri $uri/ $uri.php =404`, `server_tokens off`, gzip, static `max-age=2592000, immutable`,
`no-cache` для `/sw.js`, `version.json`, `manifest.json`, `styles.css` и JS-клиентов (включая
`code-editor.js`, `oge15-gen.js`, `oge15-ref.js`), dotfiles deny **до** правил расширений,
`limit_req zone=sandbox_oge rate=20r/s burst=60` на `run_python.php`,
**CSP** (см. «Безопасность») на HTML-страницах.
Деплой атомарный: `public` — симлинк на `releases/<ts>`; после сборки релиза
проверяются `oge.html`, `sw.js`, `version.json`, `js/progress.js`, `js/oge15-ref.js`
и `files/*.zip`. Откат — переключение симлинка на предыдущий релиз.

## 🔒 Безопасность

- `run_python.php` — 4-слойная защита (модель python-web): rate-limit (nginx `20r/s` + файловый
  600/мин по IP в /tmp с периодической чисткой), pre-фильтры (regex + белый список импортов),
  wrapper с усечёнными builtins (sentinel-канал вывода, stdin через pipe/файл), изоляция процесса
  через root-хелпер `/usr/local/sbin/sandbox-python.run` (net/pid namespace, пользователь sandbox, RLIMIT).
  **Fail-closed:** без хелпера на Linux — 503, а не запуск без изоляции. Не ослаблять ни один слой.
- Каталог `p/` удалён (бывший `overpass-proxy.php` с `verify_peer=false` больше не существует).
- **CSP** (nginx, HTML): `default-src 'self'`, скрипты — свои и `mc.yandex.ru`
  (`'unsafe-inline'` пока нужен из-за inline-обработчиков), стили — свои и inline,
  картинки — свои, `data:` и Метрика, `connect-src` — свои, Метрика и
  `auth.nayanovaacademy.ru`, `frame-src` — только `mc.yandex.ru` (Метрика создаёт
  служебный iframe даже с выключенным вебвизором); `object-src/base-uri 'none'`,
  `form-action 'self'`, `frame-ancestors 'self'`, `upgrade-insecure-requests`.
  Политика проверена headless Chrome (`tools/browser-smoke.mjs`): 35 страниц,
  0 нарушений. При добавлении внешнего ресурса — расширять политику осознанно.
- `git/index.php` раскрывает внутренности сервера (список репозиториев) — задеплоен намеренно,
  но закрыт **HTTP Basic** в nginx (`location ^~ /git/`, `auth_basic_user_file
  /etc/nginx/oge-git-htpasswd`). Логин/пароль — `/root/oge-git-ui-credentials.txt` (600);
  смена пароля — `printf 'oge:%s\n' "$(openssl passwd -apr1 'НОВЫЙ')" >
  /etc/nginx/oge-git-htpasswd` + `chown root:www-data` + `chmod 640` (reload не нужен).
  Всё под `/git/` исполняется через `git/index.php` — исходники PHP статикой не отдаются.
- `.env` и `C:\websites\na\ssh-deploy.key` — никогда не печатать/коммитить.
- Деплой атомарный: `public` — симлинк на `releases/<ts>`; серверные файлы `git/`
  переносятся в новый релиз без перезаписи, старые релизы хранятся (5) для отката.
  При ошибке распаковки/проверки live-версия не меняется.