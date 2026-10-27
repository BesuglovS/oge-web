# ==========================================
# 1. Rate limiting для Python-песочницы (уровень http)
# ==========================================
limit_req_zone $binary_remote_addr zone=sandbox_oge:10m rate=20r/s;
limit_req_status 429;

# ==========================================
# 2. Редирект HTTP → HTTPS
# ==========================================
server {
    listen 80;
    server_name oge.nayanovaacademy.ru;

    # Перенаправляем все запросы на HTTPS
    return 301 https://$host$request_uri;
}

# ==========================================
# 3. Основной HTTPS-сервер
# ==========================================
server {
    listen 443 ssl http2;
    server_name oge.nayanovaacademy.ru;

    # Не раскрываем версию nginx в ответах и на страницах ошибок.
    server_tokens off;

    # Сжатие текстовых ассетов (HTML/CSS/JS/JSON/SVG).
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json application/manifest+json image/svg+xml text/xml application/xml application/xml+rss text/javascript;

    # --- SSL-сертификаты (ваши пути) ---
    ssl_certificate     /etc/ssl/certs/nayanovaacademy.ru/cert.pem;
    ssl_certificate_key /etc/ssl/private/nayanovaacademy.ru/key.pem;

    # --- Настройки безопасности SSL ---
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # OCSP Stapling (закомментировано, т.к. ранее было предупреждение)
    # ssl_stapling on;
    # ssl_stapling_verify on;
    # resolver 8.8.8.8 8.8.4.4 valid=300s;
    # resolver_timeout 5s;

    # HSTS (обязывает браузер использовать только HTTPS)
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # --- Заголовки безопасности ---
    add_header X-Content-Type-Options "nosniff" always;
    # X-Frame-Options оставлен для старых браузеров; CSP frame-ancestors 'self'
    # дублирует его осознанно (современные браузеры используют CSP).
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    # CSP: inline-обработчиков в разметке нет (data-act + js/actions.js),
    # поэтому script-src собирается из 'self', 'sha256-…' для каждого inline
    # <script> и домена Метрики. Стили — так же: 'sha256-…' для <style> и
    # style="…" (атрибуты — через 'unsafe-hashes'), без 'unsafe-inline'.
    # Хеши подставляет deploy.ps1 при каждом деплое (tools/csp-policy.mjs) —
    # строка ниже запасная (с 'unsafe-inline'): если генератор недоступен,
    # сайт остаётся рабочим, но политика слабее.
    # Проверка политики: node tools/browser-smoke.mjs <url> --csp.
    set $csp "default-src 'self'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://mc.yandex.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mc.yandex.ru https://mc.yandex.com; font-src 'self'; connect-src 'self' https://mc.yandex.ru https://mc.yandex.com https://auth.nayanovaacademy.ru; frame-src https://mc.yandex.ru https://mc.yandex.com; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests";
    add_header Content-Security-Policy $csp always;

    # --- Основные параметры сайта ---
    root /var/www/oge.nayanovaacademy.ru/public;
    index oge.html index.html index.htm index.php;

    # Логирование
    access_log /var/log/nginx/oge.nayanovaacademy.ru.access.log;
    error_log  /var/log/nginx/oge.nayanovaacademy.ru.error.log;

    # 1. Основная маршрутизация
    location / {
        try_files $uri $uri/ $uri.php =404;
    }

    # 1a. Блокировка скрытых файлов — ДО остальных regex-локейшенов,
    # иначе `/.env.json` или `/.hidden.html` перехватит правило расширения.
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # 1b. Self-hosted git UI: список репозиториев и команды клонирования.
    # Доступ — только по паролю (файл /etc/nginx/oge-git-htpasswd создаётся
    # вне репозитория; логин и пароль — /root/oge-git-ui-credentials.txt).
    # Всё под /git/ выполняет index.php: других файлов там нет, поэтому
    # исходники PHP не могут быть отданы как статика.
    location ^~ /git/ {
        auth_basic "Git UI";
        auth_basic_user_file /etc/nginx/oge-git-htpasswd;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root/git/index.php;
        fastcgi_param SCRIPT_NAME /git/index.php;
        include fastcgi_params;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
        add_header Cache-Control "no-store" always;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }

    # 2. Python-песочница (задание 16): точный match выше regex `\.php$`,
    # обязательно с ограничением частоты (2a) и иммутабельным security-набором.
    location = /run_python.php {
        limit_req zone=sandbox_oge burst=60 nodelay;

        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        # add_header в location отменяет наследование server-level заголовков,
        # поэтому security-набор дублируется здесь.
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
        add_header Cache-Control "no-store" always;
    }

    # 2b. Обработка PHP-файлов через FastCGI
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # 3. Страница 404 (для try_files =404 и несуществующих файлов)
    error_page 404 /404.html;

    # 4. Кэширование статики
    # Ассеты без content-hash (экосистемные скрипты, точка входа, манифест,
    # styles.css) не кэшируем — иначе обновления доходят до 30 дней.
    # ВАЖНО: этот location идёт ПЕРВЫМ, иначе manifest.json перехватится
    # правилом для `.json` ниже. Security-заголовки продублированы: add_header
    # не наследуется из server{}, если в location объявлен собственный add_header.
    location ~ ^/(js/(tracking-client|progress-client|progress-sync|progress|metrika|code-editor|oge15-gen|oge15-ref)\.js|assets/styles\.css|manifest\.json|version\.json|sw\.js)$ {
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    }

    # HTML не кэшируем (содержимое может обновляться, а SW кэширует отдельно).
    location ~* \.html$ {
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
        # add_header в location отменяет наследование server{}, поэтому CSP
        # дублируется здесь: он нужен именно HTML-страницам.
        add_header Content-Security-Policy $csp always;
    }

    # Данные заданий (JSON/TXT/KuMir) — короткий кэш.
    location ~* \.(json|txt|kum)$ {
        add_header Cache-Control "public, max-age=604800" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    }

    # Скачиваемые архивы — длительный кэш (имена версионированы по заданию).
    location ~* \.zip$ {
        add_header Cache-Control "public, max-age=2592000, immutable" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
        access_log off;
    }

    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        add_header Cache-Control "public, max-age=2592000, immutable" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
        access_log off;
    }

    # 5. Блокировка скрытых файлов перенесена выше (п. 1a), чтобы её не
    # перехватывали правила расширений.
}
