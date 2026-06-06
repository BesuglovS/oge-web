<?php
// ⚙️ Настройки
$REPOS_DIR = '/home/git/repos';
$SERVER_HOST = '79.143.31.184'; // Замените на домен, если есть
$CREATE_CMD = 'create-repo <имя-репозитория>';

// Проверяем существование директории
if (!is_dir($REPOS_DIR)) {
    http_response_code(500);
    die('❌ Директория репозиториев не найдена: ' . htmlspecialchars($REPOS_DIR));
}

// Сканируем репозитории (только директории с .git)
$repos = array_filter(glob($REPOS_DIR . '/*.git'), 'is_dir');
sort($repos);
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📦 Git Server - Репозитории</title>
    <style>
        :root {
            --bg: #f3f4f6;
            --card: #ffffff;
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --text: #111827;
            --text-secondary: #6b7280;
            --border: #e5e7eb;
            --success: #10b981;
            --code-bg: #1f2937;
            --mono: 'Consolas', 'Monaco', 'Courier New', monospace;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--bg);
            color: var(--text);
            line-height: 1.6;
            padding: 2rem 1rem;
        }

        .container {
            max-width: 1000px;
            margin: 0 auto;
        }

        h1 {
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--text);
        }

        .subtitle {
            color: var(--text-secondary);
            margin-bottom: 2rem;
            font-size: 0.95rem;
        }

        .section {
            background: var(--card);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .section-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .cmd-box {
            background: var(--code-bg);
            color: #e5e7eb;
            padding: 1rem;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            font-family: var(--mono);
            font-size: 0.9rem;
            overflow-x: auto;
        }

        .cmd-text {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .copy-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85rem;
            font-weight: 500;
            white-space: nowrap;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }

        .copy-btn:hover {
            background: var(--primary-hover);
            transform: translateY(-1px);
        }

        .copy-btn:active {
            transform: translateY(0);
        }

        .copy-btn.copied {
            background: var(--success);
        }

        .repo-list {
            list-style: none;
            display: grid;
            gap: 1rem;
        }

        .repo-item {
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 1rem;
            transition: all 0.2s;
        }

        .repo-item:hover {
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            border-color: var(--primary);
        }

        .repo-name {
            font-weight: 600;
            font-size: 1.05rem;
            color: var(--primary);
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .empty-state {
            text-align: center;
            padding: 3rem 1rem;
            color: var(--text-secondary);
        }

        .empty-state-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        .hint {
            background: #eff6ff;
            border-left: 4px solid var(--primary);
            padding: 0.75rem 1rem;
            border-radius: 6px;
            margin-bottom: 1.5rem;
            font-size: 0.9rem;
            color: #1e40af;
        }

        footer {
            text-align: center;
            color: var(--text-secondary);
            font-size: 0.85rem;
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border);
        }

        @media (max-width: 640px) {
            .cmd-box {
                flex-direction: column;
                align-items: stretch;
            }
            
            .cmd-text {
                white-space: normal;
                word-break: break-all;
            }
            
            .copy-btn {
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📦 Git Server</h1>
        <p class="subtitle">Список доступных репозиториев и команды для работы</p>

        <!-- Секция: Список репозиториев -->
        <div class="section">
            <div class="section-title">
                <span>📁</span>
                <span>Репозитории (<?= count($repos) ?>)</span>
            </div>

            <?php if (empty($repos)): ?>
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <p>Репозитории пока не созданы</p>
                    <p style="font-size: 0.9rem; margin-top: 0.5rem;">Используйте команду ниже для создания первого репозитория</p>
                </div>
            <?php else: ?>
                <ul class="repo-list">
                    <?php foreach ($repos as $repoPath): ?>
                        <?php 
                        $repoName = basename($repoPath);
                        $cloneCmd = "git clone git@{$SERVER_HOST}:{$repoPath}";
                        $repoId = md5($repoName);
                        ?>
                        <li class="repo-item">
                            <div class="repo-name">
                                <span></span>
                                <span><?= htmlspecialchars($repoName) ?></span>
                            </div>
                            <div class="cmd-box">
                                <code class="cmd-text" id="clone-<?= $repoId ?>"><?= htmlspecialchars($cloneCmd) ?></code>
                                <button class="copy-btn" onclick="copyToClipboard('clone-<?= $repoId ?>', this)">
                                    <span>📋</span>
                                    <span>Копировать</span>
                                </button>
                            </div>
                        </li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>
        </div>

        <!-- Секция: Управление репозиториями -->
        <div class="section">
            <div class="section-title">
                <span>🛠️</span>
                <span>Управление репозиториями</span>
            </div>
            <div class="hint">
                💡 Выполните эти команды на сервере (под root) для управления репозиториями
            </div>

            <p style="margin-bottom: 0.5rem; font-weight: 500;">Создать репозиторий:</p>
            <div class="cmd-box" style="margin-bottom: 1rem;">
                <code class="cmd-text" id="create-cmd"><?= htmlspecialchars($CREATE_CMD) ?></code>
                <button class="copy-btn" onclick="copyToClipboard('create-cmd', this)">
                    <span>📋</span>
                    <span>Копировать</span>
                </button>
            </div>

            <p style="margin-bottom: 0.5rem; font-weight: 500;">Удалить репозиторий:</p>
            <div class="cmd-box" style="margin-bottom: 1rem;">
                <code class="cmd-text" id="delete-cmd">delete-repo <имя-репозитория></code>
                <button class="copy-btn" onclick="copyToClipboard('delete-cmd', this)">
                    <span>📋</span>
                    <span>Копировать</span>
                </button>
            </div>

            <p style="margin-bottom: 0.5rem; font-weight: 500;">Мигрировать репозиторий с GitHub:</p>
            <input type="text" id="github-url" placeholder="https://github.com/BesuglovS/akaquiz.git" oninput="updateMigrateCmd()" style="width: 100%; padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-radius: 6px; font-family: var(--mono); font-size: 0.9rem; margin-bottom: 0.75rem; box-sizing: border-box;" value="https://github.com/BesuglovS/akaquiz.git">
            <div class="cmd-box">
                <code class="cmd-text" id="migrate-cmd">migrate-from-github https://github.com/BesuglovS/akaquiz.git akaquiz</code>
                <button class="copy-btn" onclick="copyToClipboard('migrate-cmd', this)">
                    <span>📋</span>
                    <span>Копировать</span>
                </button>
            </div>

            <p style="margin-top: 1rem; font-size: 0.85rem; color: #9ca3af;">
                🔑 Для доступа к серверу скопируйте файлы SSH-ключей <code style="background: #374151; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem;">id_ed25519</code> и <code style="background: #374151; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem;">id_ed25519.pub</code> в папку <code style="background: #374151; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem;">~/.ssh</code> каталога пользователя
            </p>
        </div>

        <footer>
            <p>Git Server • <?= date('Y') ?> • Доступ по SSH-ключам</p>
            <p style="margin-top: 0.25rem; font-size: 0.8rem;">
                Сервер: <?= htmlspecialchars($SERVER_HOST) ?>
            </p>
        </footer>
    </div>

    <script>
        function updateMigrateCmd() {
            const url = document.getElementById('github-url').value.trim();
            const cmdElement = document.getElementById('migrate-cmd');
            if (url) {
                const repoName = url.replace(/\.git$/, '').split('/').pop();
                cmdElement.innerText = 'migrate-from-github ' + url + ' ' + repoName;
            } else {
                cmdElement.innerText = 'migrate-from-github <url> <имя-репозитория>';
            }
        }

        async function copyToClipboard(elementId, button) {
            const element = document.getElementById(elementId);
            const text = element.innerText;
            
            try {
                await navigator.clipboard.writeText(text);
                
                // Визуальная обратная связь
                const originalHTML = button.innerHTML;
                button.classList.add('copied');
                button.innerHTML = '<span>✅</span><span>Скопировано!</span>';
                
                setTimeout(() => {
                    button.classList.remove('copied');
                    button.innerHTML = originalHTML;
                }, 2000);
                
            } catch (err) {
                // Fallback для старых браузеров
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();
                
                try {
                    document.execCommand('copy');
                    const originalHTML = button.innerHTML;
                    button.classList.add('copied');
                    button.innerHTML = '<span>✅</span><span>Скопировано!</span>';
                    
                    setTimeout(() => {
                        button.classList.remove('copied');
                        button.innerHTML = originalHTML;
                    }, 2000);
                } catch (err) {
                    alert('Не удалось скопировать. Пожалуйста, выделите текст и скопируйте вручную.');
                }
                
                document.body.removeChild(textArea);
            }
        }
    </script>
</body>
</html>