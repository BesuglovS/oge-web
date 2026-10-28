# ОГЭ — Интерактивные задания по информатике

[![checks](https://github.com/BesuglovS/oge-web/actions/workflows/checks.yml/badge.svg)](https://github.com/BesuglovS/oge-web/actions/workflows/checks.yml)

Интерактивное веб-приложение для подготовки к Основному государственному
экзамену (ОГЭ) по информатике. 17 интерактивных страниц (16 номеров заданий;
13.1 и 13.2 — отдельные тренажёры), теория по всем номерам, подсказки и разбор
решений. Поддерживает мышь и сенсорные экраны, работает как PWA (офлайн-режим).

Прод: <https://oge.nayanovaacademy.ru>

## 🎯 Задания

Интерактивные (`ogeN.html`) и теоретические (`ogeN-t.html`) страницы:

| № | Тема | Интерактив |
|---|------|-----------|
| 1 | Информационный объём | ввод ответа |
| 2 | Декодирование сообщений (условие Фано) | ввод ответа |
| 3 | Истинность высказывания | ввод ответа |
| 4 | Анализ модели объектов (кратчайший путь) | интерактив + `oge4-path.html` |
| 5 | Анализ алгоритмов для исполнителя | выбор ответа |
| 6 | Анализ программы | ввод ответа |
| 7 | Составление URL-адреса | drag-and-drop |
| 8 | Множества и круги Эйлера | ввод ответа |
| 9 | Анализ схем и графов | ввод ответа |
| 10 | Системы счисления | ввод ответа |
| 11 | Информационный поиск | ввод ответа (архив `files/Задание11-12.zip`) |
| 12 | Файловая система | ввод ответа (архив `files/Задание11-12.zip`) |
| 13.1 | Создание презентации | чек-лист (`oge131.html`) |
| 13.2 | Создание текстового документа | чек-лист (`oge132.html`) |
| 14 | Электронные таблицы | тренажёр формул и 20 вариантов ОГЭ с диаграммами (`oge14.html`) |
| 15 | Исполнитель Робот (Кумир) | интерпретатор КуМир на JS |
| 16 | Программирование на Python | серверная песочница |

Теория есть у каждого задания (`ogeN-t.html`). Интерактивные страницы:
`oge1.html`…`oge12.html`, `oge131.html`, `oge132.html`, `oge14.html`,
`oge15.html`, `oge16.html`.

## 🛠️ Технологии

- **HTML5 / CSS3 / JavaScript** — статические страницы (vanilla JS, inline-логика).
- **Service Worker + Web App Manifest** — PWA и офлайн-режим (`sw.js`, `manifest.json`).
- **PHP 8.1** — песочница Python для задания 16 (`run_python.php`).
- **localStorage** — локальный прогресс (`js/progress.js`), синхронизация с
  порталом Академии (`js/progress-client.js`, `js/progress-sync.js`).
- **Yandex.Metrika** — аналитика и трекинг событий (`js/metrika.js`).

## 🚀 Запуск

Статические страницы можно открыть напрямую, но для Service Worker, PHP-песочницы
и корректной работы `fetch` нужен локальный сервер:

```bash
# Только статика (задания 1–15, PWA)
python -m http.server 8000

# С PHP (задание 16, run_python.php)
php -S 127.0.0.1:8080
```

Затем откройте <http://localhost:8000> (или `:8080`).

Статические проверки (ссылки, canonical, sw-ассеты вместе с 40 файлами задания 15,
иконки, head-теги, BOM, sitemap, разметка/доступность, бюджет размера), CSS-аудит,
проверки данных (577 тестов задания 16, ответы генераторов заданий 1–10, сверка
`.kum`↔`e-*.json` и генератора задания 15, структура `data/oge7.json`, ответы заданий
11 и 12 по архиву), примеры кода теории, песочница и PHP-линт:

```bash
node tools/check-site.mjs
node tools/check-css.mjs          # CSS-аудит + известные конфликты
node tools/check-data.mjs         # нужен python 3
node tools/check-theory.mjs       # примеры кода в теории (python 3)
node tools/check-oge11-archive.mjs # ответы задания 11 по архиву (python 3)
node tools/check-sandbox.mjs      # нужен php + python 3
node tools/check-links.mjs        # внешние ссылки (нужен интернет, вне CI)
php -l run_python.php
```

## ✨ Особенности

- Адаптивный дизайн и touch-поддержка.
- Мгновенная проверка ответа и случайная генерация заданий.
- Подсказки и подробные решения.
- Единая система прогресса (уровни, процент пройденного) в `localStorage`;
  прогресс сразу уходит на портал с любой интерактивной страницы.
- PWA: офлайн-доступ и офлайн-страница `offline.html`.
- Доступность: skip-link, ARIA-атрибуты, focus-стили, клавиатурное управление
  полем Робота (стрелки/пробел), сборкой URL (задание 7), разделителями
  шифрограммы (задание 2) и таблицей расстояний в `oge4-path` (Enter/стрелки).
- Интерпретатор КуМир для исполнителя Робот: `нц пока`, `нц N раз`,
  `нц для i от A до B [шаг S]`, `если`, регистронезависимые ключевые слова
  (задание 15).
- Изолированная Python-песочница для задания 16 (fail-closed без root-хелпера);
  тесты уходят одним запросом (до 12 за раз).

## 📁 Структура проекта

```
oge-web/
├── oge.html              # Лендинг (карточки заданий) + сводка прогресса
├── oge{N}.html           # Интерактивные задания 1–16
├── oge{N}-t.html         # Теория к заданиям
├── oge4-path.html        # Доп. тренажёр: кратчайший путь в графе
├── run_python.php        # Python-песочница (задание 16)
├── assets/               # styles.css, favicon.svg, иконки
├── js/                   # metrika.js, actions.js, checklist.js, progress.js,
│                         # progress-client.js, progress-sync.js, tracking-client.js
├── data/oge7.json        # Данные задания 7
├── files/                # Задание11-12.zip, files/oge15/ (данные задания 15)
├── git/index.php         # Web-UI self-hosted git-репозиториев
├── tools/                # check-site.mjs, check-css.mjs, check-data.mjs,
│                         # check-sandbox.mjs, gen-oge15-ref.mjs, css-utils.mjs
├── manifest.json, sw.js  # PWA
├── offline.html, 404.html
├── deploy.ps1            # Деплой (tar + ssh)
└── oge.nayanovaacademy.ru # nginx-конфиг (tracked, деплоится отдельно)
```

## 🔒 Python-песочница (задание 16)

`run_python.php` выполняет код ученика в несколько слоёв защиты:

1. POST-only, лимит 20 КБ кода, rate-limit по IP (nginx `20r/s` + файловый 600/мин).
2. Pre-фильтры: белый список модулей и запрет опасных конструкций.
3. Wrapper с усечёнными builtins (нет `open`/`eval`/`exec`/`getattr`, импорт —
   только по белому списку).
4. Изоляция процесса через root-хелпер `sandbox-python.run`
   (net/pid namespace, пользователь `sandbox`, RLIMIT_AS/CPU, timeout 5 с).
   Если хелпера нет на Linux — песочница отвечает 503 (fail-closed).

Сравнение вывода — после нормализации пробелов; числовые ответы сравниваются
с допуском (чтобы `14.0`, `14.00` и `14` считались одним ответом).

## 🚀 Деплой

```powershell
.\deploy.ps1 -DryRun   # сухой прогон
.\deploy.ps1           # деплой
.\deploy.ps1 -Rollback # откат на предыдущий релиз
.\deploy.ps1 -Rollback -Release 20261025-095536-1648371
```

`deploy.ps1` читает `.env`, пакует проект `tar`-ом (без `.git`, `.env`,
`deploy.ps1`, документации, nginx-конфига, `p`, `tools`, `.github`), заливает
по SSH и разворачивает **атомарно**: новый релиз в `releases/<ts>`, smoke-check,
затем `public` — симлинк на релиз (старые релизы хранятся для отката; при ошибке
live не меняется). nginx-конфиг деплоится отдельно через
`sudo /usr/local/sbin/deploy-nginx.sh`.

## 📄 Лицензия

MIT License — см. файл [LICENSE](LICENSE).

Copyright (c) 2026 Bezuglov Sergey

## 👤 Автор

**Bezuglov Sergey**

- GitHub: [@BesuglovS](https://github.com/BesuglovS)
- Repository: <https://github.com/BesuglovS/oge-web>

---

Подробнее об архитектуре см. в [ARCHITECTURE.md](ARCHITECTURE.md).
