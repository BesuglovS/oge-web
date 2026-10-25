# ==========================================
# 1. Rate limiting для Python-песочницы (уровень http)
# ==========================================
limit_req_zone $binary_remote_addr zone=sandbox_oge:10m rate=5r/s;
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
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

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

    # 2. Python-песочница (задание 16): точный match выше regex `\.php$`,
    # обязательно с ограничением частоты (2a) и иммутабельным security-набором.
    location = /run_python.php {
        limit_req zone=sandbox_oge burst=10 nodelay;

        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        # add_header в location отменяет наследование server-level заголовков,
        # поэтому security-набор дублируется здесь.
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
    location ~ ^/(js/(tracking-client|progress-client|progress-sync|progress|metrika)\.js|assets/styles\.css|manifest\.json|version\.json|sw\.js)$ {
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    }

    # HTML не кэшируем (содержимое может обновляться, а SW кэширует отдельно).
    location ~* \.html$ {
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    }

    # Данные заданий (JSON/TXT/KuMir) — короткий кэш.
    location ~* \.(json|txt|kum)$ {
        expires 7d;
        add_header Cache-Control "public" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    }

    # Скачиваемые архивы — длительный кэш (имена версионированы по заданию).
    location ~* \.zip$ {
        expires 30d;
        add_header Cache-Control "public, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
        access_log off;
    }

    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
        access_log off;
    }

    # 5. Блокировка скрытых файлов
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
