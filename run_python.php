<?php
/**
 * run_python.php - Запуск Python-кода для проверки заданий ОГЭ.
 * Принимает: code (Python-код) и test_input (входные данные для stdin)
 * Возвращает: JSON с выводом, ошибками, результатом сравнения.
 *
 * Защита (сентябрь 2026, модель python-web):
 *   1. Rate-limit по IP (файловый, под flock) + nginx limit_req zone=sandbox_oge.
 *   2. Pre-фильтры: белый список модулей + regex-запрет опасных конструкций
 *      (defense-in-depth, не единственный слой).
 *   3. Wrapper с усечёнными builtins: код пользователя исполняется через
 *      exec(compile(...)) в namespace без open/eval/exec/getattr и т.п.,
 *      импорты — только через белый список.
 *   4. Реальная изоляция процесса: sudo-хелпер /usr/local/sbin/sandbox-python.run
 *      (unshare net+pid, setpriv -> пользователь sandbox, prlimit RLIMIT_AS/CPU).
 *      Если хелпер недоступен — прямой запуск с RLIMIT в пре-коде (dev-fallback).
 *
 * Лимиты: POST-only, 20 КБ кода, timeout 5 сек.
 */

// ─── 1. Только POST ───
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('HTTP/1.1 405 Method Not Allowed');
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Only POST method allowed']);
    exit;
}

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
// Отпечаток файла: deploy-скрипт сверяет его с локальным, чтобы поймать
// ситуацию, когда PHP-FPM после переключения симлинка public продолжает
// выполнять старый run_python.php (нужен opcache.revalidate_path=1).
header('X-Sandbox-Build: ' . substr((string) hash_file('sha256', __FILE__), 0, 12));

// ─── 2. Rate-limit по IP (файловый, flock) ───
oge_rate_limit();

// Клиент задания 16 запускает по одному тесту на запрос (обычно 8–10 тестов
// за прогон), поэтому лимит выставлен с запасом на параллельную работу класса
// за одним NAT-IP (25 учеников × 10 тестов ≈ 250 запросов за минуту).
// Основной анти-абьюз-барьер — nginx limit_req (20 r/s, burst 60) в конфиге
// `oge.nayanovaacademy.ru`; файловый слой остаётся вторичным.
function oge_rate_limit(int $limit = 600, int $window = 60): void {
    // Каталог rate-limit — вне webroot: webroot принадлежит deploy
    // (www-data не имеет права записи, это часть изоляции).
    $dir = sys_get_temp_dir() . '/oge-sandbox-ratelimit';
    @mkdir($dir, 0700, true);
    if (!is_dir($dir)) {
        return; // каталог недоступен — не блокируем работу эндпоинта
    }
    // Изредка подчищаем файлы IP, которые не заходили дольше двух часов,
    // иначе каталог растёт неограниченно.
    if (random_int(1, 200) === 1) {
        foreach ((array)glob($dir . '/*.json') as $old) {
            if (is_file($old) && (time() - (int)@filemtime($old)) > 7200) {
                @unlink($old);
            }
        }
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $file = $dir . '/' . md5($ip) . '.json';
    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        return;
    }
    flock($handle, LOCK_EX);
    $now = time();
    $windowArr = [];
    $content = stream_get_contents($handle);
    if ($content !== false && $content !== '') {
        $decoded = json_decode($content, true);
        if (is_array($decoded)) {
            $windowArr = array_values(array_filter($decoded, fn($ts) => is_numeric($ts) && ($now - (int)$ts) < $window));
        }
    }
    if (count($windowArr) >= $limit) {
        flock($handle, LOCK_UN);
        fclose($handle);
        header('Content-Type: application/json');
        header('Retry-After: ' . max(1, $window - ($now - (int)$windowArr[0])));
        http_response_code(429);
        echo json_encode(['error' => 'Слишком много запросов. Подождите минуту.']);
        exit;
    }
    $windowArr[] = $now;
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($windowArr));
    flock($handle, LOCK_UN);
    fclose($handle);
}

// ─── 3. Получаем данные ───
$code = isset($_POST['code']) ? $_POST['code'] : '';
$testInput = isset($_POST['test_input']) ? $_POST['test_input'] : '';
$expectedOutput = isset($_POST['expected_output']) ? $_POST['expected_output'] : '';
// Пакетный режим: JSON [{"input": "...", "expected": "..."}, ...].
$testsJson = isset($_POST['tests']) && is_string($_POST['tests']) ? trim($_POST['tests']) : '';

if (trim($code) === '') {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Код не может быть пустым']);
    exit;
}

if (strlen($code) > 20480) {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Код слишком большой (максимум 20 KB)']);
    exit;
}

if (strlen($testInput) > 102400) {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Входные данные слишком длинные']);
    exit;
}

if (strlen($expectedOutput) > 102400) {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Ожидаемый вывод слишком длинный']);
    exit;
}

// ─── 4. Pre-фильтры (слой 2) ───
$allowedModules = ['math', 'random', 'datetime', 'decimal', 'fractions', 'string', 're', 'collections', 'itertools', 'functools', 'operator', 'json', 'csv'];

$forbiddenPatterns = [
    '/\b__import__\b/',
    '/\b__builtins__\b/',
    '/\b__import_attr__\b/',
    '/\bbreakpoint\b/',
    '/\bhelp\s*\(/',
    '/__class__/',
    '/__bases__/',
    '/__subclasses__/',
    '/__mro__/',
    '/__globals__/',
    '/__code__/',
    '/__closure__/',
    '/__dict__/',
    '/__getattribute__/',
    '/__setattr__/',
    '/__reduce__/',
    '/__reduce_ex__/',
    '/\bf_globals\b/',
    '/\bf_locals\b/',
    '/\bgi_frame\b/',
    '/\bexec\s*\(/',
    '/\beval\s*\(/',
    '/\bcompile\s*\(/',
    '/\bos\b/',
    '/\bsubprocess\b/',
    '/\bshutil\b/',
    '/\bsys\b/',
    '/\bsocket\b/',
    '/\bctypes\b/',
    '/\bopen\s*\(/',
    '/\bPopen\b/',
    '/\bfork\b/',
    '/\bexecve\b/',
    '/\bexecvp\b/',
    '/\bkill\b/',
    '/\bexit\s*\(/',
    '/\bquit\s*\(/',
];

// Для regex-фильтра убираем строковые литералы и комментарии: иначе
// `print("Файл os")` или `# здесь был sys` ложно блокируются. Реальная
// защита — wrapper с усечёнными builtins, это лишь первый слой.
$codeForScan = preg_replace([
    '/"""[\s\S]*?"""/',
    "/'''[\s\S]*?'''/",
    '/#[^\n]*/',
    '/"(?:\\\\.|[^"\\\\])*"/s',
    "/'(?:\\\\.|[^'\\\\])*'/s",
], ' ', $code);
// Если PCRE по какой-то причине не справился — фильтруем исходный код
// (лучше ложное срабатывание, чем пропуск запрещённой конструкции).
if (!is_string($codeForScan)) {
    $codeForScan = $code;
}

foreach ($forbiddenPatterns as $pattern) {
    if (preg_match($pattern, $codeForScan, $matches)) {
        header('Content-Type: application/json');
        echo json_encode([
            'error' => 'Код содержит запрещённую операцию "' . trim($matches[0]) . '". Используйте только print, переменные, условия, циклы и разрешённые модули (math, random, datetime).'
        ]);
        exit;
    }
}

// Разбор import-выражений построчно, чтобы `from math import sqrt`
// не воспринимался как `import sqrt` (прежний баг: whitelist отвергал имена).
// Поддерживаются `import a, b as c`, `from x import ...`, `from x.y import ...`,
// несколько инструкций через `;` и строчный комментарий после них.
$codeLines = preg_split('/\R/', $code);
foreach ($codeLines as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#') {
        continue;
    }
    foreach (explode(';', $line) as $statement) {
        $statement = trim(preg_replace('/\s+#.*$/', '', $statement));
        if ($statement === '') {
            continue;
        }
        if (preg_match('/^from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import\b/', $statement, $m)) {
            $root = explode('.', $m[1])[0];
            if (!in_array($root, $allowedModules, true)) {
                header('Content-Type: application/json');
                echo json_encode([
                    'error' => "Модуль '$root' запрещён. Разрешённые модули: " . implode(', ', $allowedModules)
                ]);
                exit;
            }
        } elseif (preg_match('/^import\s+(.+)$/', $statement, $m)) {
            foreach (explode(',', $m[1]) as $part) {
                $name = trim(preg_split('/\s+as\s+/i', trim($part))[0]);
                $root = explode('.', $name)[0];
                if ($root === '') {
                    continue;
                }
                if (!in_array($root, $allowedModules, true)) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'error' => "Модуль '$root' запрещён. Разрешённые модули: " . implode(', ', $allowedModules)
                    ]);
                    exit;
                }
            }
        }
    }
}

// ─── 5. Wrapper с усечёнными builtins (слой 3) ───
$sentinel = bin2hex(random_bytes(16));
$encoded = base64_encode($code);
$wrapper = oge_build_wrapper($encoded, $sentinel, $allowedModules);

/**
 * Wrapper: exec(compile(base64-код)) в namespace с усечёнными builtins.
 * Защита в глубину: без open/eval/exec/getattr и импортов вне белого списка.
 */
function oge_build_wrapper(string $encoded, string $sentinel, array $allowedModules): string {
    $stdoutBegin = '_OGE_STDOUT_' . $sentinel . '_BEGIN_';
    $stdoutEnd   = '_OGE_STDOUT_' . $sentinel . '_END_';
    $stderrBegin = '_OGE_STDERR_' . $sentinel . '_BEGIN_';
    $stderrEnd   = '_OGE_STDERR_' . $sentinel . '_END_';

    $template = <<<'PYTHON'
import sys as _oge_sys
import io as _oge_io
import builtins as _oge_builtins
import base64 as _oge_base64

_oge_original_stdout = _oge_sys.stdout
_oge_sys.stdout = _oge_io.StringIO()
_oge_original_stderr = _oge_sys.stderr
_oge_sys.stderr = _oge_io.StringIO()

_oge_blocked = frozenset({
    'open', 'exec', 'eval', 'compile', 'breakpoint',
    'getattr', 'setattr', 'delattr',
    'globals', 'locals', 'vars', 'dir',
    'help', 'memoryview', 'exit', 'quit',
})
_oge_allowed = frozenset(%ALLOWED_MODULES%)
_oge_real_import = _oge_builtins.__import__

def _oge_safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level > 0:
        raise ImportError('Относительные импорты запрещены')
    root = name.split('.')[0]
    if root not in _oge_allowed:
        raise ImportError('Модуль "%s" недоступен' % root)
    return _oge_real_import(name, globals, locals, fromlist, level)

_oge_safe_builtins = {
    _n: getattr(_oge_builtins, _n)
    for _n in dir(_oge_builtins)
    if not _n.startswith('_') and _n not in _oge_blocked
}
_oge_safe_builtins['__build_class__'] = _oge_builtins.__build_class__
_oge_safe_builtins['__debug__'] = True
_oge_safe_builtins['__import__'] = _oge_safe_import
_oge_globals = {'__name__': '__main__', '__builtins__': _oge_safe_builtins}

try:
    exec(compile(_oge_base64.b64decode('%CODE%').decode('utf-8'), '<task>', 'exec'), _oge_globals)
except SystemExit:
    raise
except BaseException as _oge_exc:
    _oge_sys.stderr.write(type(_oge_exc).__name__ + ': ' + str(_oge_exc) + '\n')
finally:
    _oge_out_stdout = _oge_sys.stdout.getvalue()
    _oge_out_stderr = _oge_sys.stderr.getvalue()
    _oge_sys.stdout = _oge_original_stdout
    _oge_sys.stderr = _oge_original_stderr
    import sys as _oge_sys2
    _oge_sys2.stdout.write("%STDOUT_BEGIN%" + _oge_out_stdout + "%STDOUT_END%")
    _oge_sys2.stdout.write("%STDERR_BEGIN%" + _oge_out_stderr + "%STDERR_END%")
PYTHON;

    return str_replace(
        ['%CODE%', '%STDOUT_BEGIN%', '%STDOUT_END%', '%STDERR_BEGIN%', '%STDERR_END%', '%ALLOWED_MODULES%'],
        [
            $encoded,
            $stdoutBegin,
            $stdoutEnd,
            $stderrBegin,
            $stderrEnd,
            json_encode(array_values($allowedModules), JSON_UNESCAPED_UNICODE),
        ],
        $template
    );
}

// ─── 6. Выполнение (слой 4: изоляция через sudo-хелпер или RLIMIT prelude) ───
$tmpFile = tempnam(sys_get_temp_dir(), 'oge16_');
file_put_contents($tmpFile, $wrapper);

const OGE_MEMORY_LIMIT_MB = 128;
const OGE_TIMEOUT_SEC = 5;

/* Пакетный режим: несколько тестов за один HTTP-запрос.
   Код проверяется и оборачивается один раз, дальше он просто запускается
   с разными входными данными. Ограничения: не больше 12 тестов и 200 КБ
   суммарных данных, иначе — отказ. */
if ($testsJson !== '') {
    $cases = json_decode($testsJson, true);
    if (!is_array($cases) || count($cases) < 1 || !array_is_list($cases)) {
        @unlink($tmpFile);
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Некорректный список тестов']);
        exit;
    }
    if (count($cases) > 12) {
        @unlink($tmpFile);
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Слишком много тестов за один раз (максимум 12)']);
        exit;
    }
    $totalBytes = 0;
    foreach ($cases as $case) {
        if (!is_array($case) || !isset($case['input'], $case['expected'])
            || !is_string($case['input']) || !is_string($case['expected'])) {
            @unlink($tmpFile);
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Каждый тест должен содержать input и expected']);
            exit;
        }
        $totalBytes += strlen($case['input']) + strlen($case['expected']);
    }
    if ($totalBytes > 204800) {
        @unlink($tmpFile);
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Суммарные данные тестов слишком большие']);
        exit;
    }

    $results = [];
    $stopped = false;
    // Бюджет времени: PHP-FPM режет запрос на 30 с, поэтому после 20 с
    // перестаём запускать новые тесты и помечаем остальные как пропущенные.
    $deadline = microtime(true) + 20.0;
    foreach ($cases as $case) {
        if (!$stopped && microtime(true) > $deadline) {
            $stopped = true;
        }
        if ($stopped) {
            $results[] = [
                'input' => $case['input'],
                'expected' => $case['expected'],
                'output' => '',
                'matched' => false,
                'skipped' => true,
            ];
            continue;
        }
        list($rawOut, $rawErr, $code, $timedOut) = oge_run($tmpFile, $case['input'], OGE_TIMEOUT_SEC, OGE_MEMORY_LIMIT_MB);
        if ($rawOut === false) {
            @unlink($tmpFile);
            http_response_code(503);
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Песочница временно недоступна. Попробуйте позже.',
                'unavailable' => true,
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $parsed = oge_parse_sentinels($rawOut, $sentinel);
        $out = oge_truncate($parsed['stdout']);
        $err = $parsed['stderr'];
        if ($timedOut) {
            $results[] = [
                'input' => $case['input'],
                'expected' => $case['expected'],
                'output' => '',
                'matched' => false,
                'timeout' => true,
                'error' => '⏱️ Превышено время выполнения (5 сек). Проверьте, нет ли бесконечного цикла в вашей программе.',
            ];
            $stopped = true;
            continue;
        }
        if ($rawErr !== '' && $err === '') {
            $err = oge_sanitize_stderr($rawErr);
        }
        $err = oge_truncate($err);
        if ($err !== '') {
            $results[] = [
                'input' => $case['input'],
                'expected' => $case['expected'],
                'output' => $out,
                'matched' => false,
                'error' => $err,
            ];
            $stopped = true;
            continue;
        }
        if ($code !== 0 && $out === '') {
            $results[] = [
                'input' => $case['input'],
                'expected' => $case['expected'],
                'output' => '',
                'matched' => false,
                'error' => "Ошибка выполнения (код: $code)",
            ];
            $stopped = true;
            continue;
        }
        $results[] = [
            'input' => $case['input'],
            'expected' => $case['expected'],
            'output' => $out,
            'matched' => oge_compare($out, $case['expected']),
        ];
    }
    @unlink($tmpFile);

    $passed = 0;
    foreach ($results as $r) {
        if (!empty($r['matched'])) {
            $passed++;
        }
    }
    header('Content-Type: application/json');
    echo json_encode([
        'results' => $results,
        'passed' => $passed,
        'total' => count($cases),
        'stopped' => $stopped,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

list($rawStdout, $rawStderr, $exitCode, $timedOut) = oge_run($tmpFile, $testInput, OGE_TIMEOUT_SEC, OGE_MEMORY_LIMIT_MB);
@unlink($tmpFile);

// Песочница не смогла стартовать (нет root-хелпера / запрещён fallback):
// это не ошибка ученика, а недоступность сервиса.
if ($rawStdout === false) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'Песочница временно недоступна. Попробуйте позже.',
        'unavailable' => true
    ]);
    exit;
}

$parsed = oge_parse_sentinels($rawStdout, $sentinel);
$output = oge_truncate($parsed['stdout']);
$errorOutput = $parsed['stderr'];

if ($timedOut) {
    header('Content-Type: application/json');
    echo json_encode([
        'error' => '⏱️ Превышено время выполнения (5 сек). Проверьте, нет ли бесконечного цикла в вашей программе.',
        'timeout' => true
    ]);
    exit;
}

if ($rawStderr !== '' && $errorOutput === '') {
    $errorOutput = oge_sanitize_stderr($rawStderr);
}
$errorOutput = oge_truncate($errorOutput);

// ─── 7. Сравнение с ожидаемым результатом ───
// Строки сравниваются после нормализации пробелов; числа — с допуском,
// чтобы «14.0», «14.00» и «14» (а также «10.5» и «10.50») считались
// одним и тем же ответом при округлении среднего.
$matched = oge_compare($output, $expectedOutput);

$result = [];
if ($errorOutput !== '') {
    $result['error'] = $errorOutput;
    $result['output'] = $output;
    $result['expected'] = $expectedOutput;
    $result['matched'] = false;
} elseif ($exitCode !== 0 && $output === '') {
    $result['error'] = "Ошибка выполнения (код: $exitCode)";
    $result['output'] = '';
    $result['expected'] = $expectedOutput;
    $result['matched'] = false;
} else {
    $result['output'] = $output;
    $result['expected'] = $expectedOutput;
    $result['matched'] = $matched;
}

header('Content-Type: application/json');
echo json_encode($result);

/* ═══════════════════ Helper functions ═══════════════════ */

/**
 * Сравнивает вывод программы с ожидаемым: сначала после нормализации
 * пробелов, затем (если оба числа) с относительным допуском 1e-9.
 * Используется и в одиночном, и в пакетном режиме.
 */
function oge_compare(string $output, string $expected): bool {
    $a = trim(preg_replace('/\s+/', ' ', $output));
    $b = trim(preg_replace('/\s+/', ' ', $expected));
    if ($a === $b) {
        return true;
    }
    if ($a !== '' && is_numeric($a) && is_numeric($b)) {
        $got = (float)$a;
        $want = (float)$b;
        $scale = max(1.0, abs($want));
        return abs($got - $want) <= 1e-9 * $scale;
    }
    return false;
}

/**
 * Запускает скрипт: через изолирующий sudo-хелпер (если установлен),
 * либо напрямую python3 -I -S с RLIMIT-префиксом в скрипте (dev-fallback).
 */
function oge_run(string $tmpFile, string $stdinData, int $timeout, int $memoryMb): array {
    $memBytes = $memoryMb * 1024 * 1024;
    $helper = getenv('SANDBOX_RUN_HELPER');
    if ($helper === false || $helper === '') {
        $helper = '/usr/local/sbin/sandbox-python.run';
    }

    // Windows-фолбэк для локальной разработки: launcher `py` под proc_open
    // с массивом аргументов передаёт `-3` напрямую в python.exe и падает,
    // поэтому используем `python`.
    $isWindows = DIRECTORY_SEPARATOR === '\\';
    $argvBase = $isWindows ? ['python'] : ['/usr/bin/python3'];
    $useHelper = !$isWindows && is_file($helper) && is_executable($helper);

    if ($useHelper) {
        // Изоляция: root-хелпер -> unshare -> sandbox user -> prlimit
        $cmd = array_merge(
            ['/usr/bin/sudo', '-n', '--', $helper],
            [$tmpFile, (string)$memoryMb, (string)$timeout, '/usr/bin/python3']
        );
        // Хелпер запускает python от пользователя sandbox, поэтому файл
        // должен быть доступен на чтение (ограничение текущего хелпера:
        // он принимает путь к файлу, а не код через stdin).
        @chmod($tmpFile, 0644);
    } elseif ($isWindows || getenv('SANDBOX_ALLOW_FALLBACK') === '1') {
        // Fallback без хелпера (только локальная разработка): RLIMIT-префикс
        // в скрипте + хард-токаут процесса через proc_terminate() ниже.
        // В продакшене при отсутствии хелпера работаем fail-closed, чтобы
        // не исполнять код ученика без реальной изоляции.
        $script = (string) file_get_contents($tmpFile);
        $prelude =
            "try:\n" .
            "    import resource\n" .
            "    resource.setrlimit(resource.RLIMIT_AS, ($memBytes, $memBytes))\n" .
            "    resource.setrlimit(resource.RLIMIT_FSIZE, (2097152, 2097152))\n" .
            "except (ImportError, ValueError, OSError):\n" .
            "    pass\n";
        file_put_contents($tmpFile, $prelude . $script);
        $cmd = array_merge($argvBase, ['-I', '-S', '-X', 'utf8', $tmpFile]);
    } else {
        error_log('run_python: sandbox helper is unavailable: ' . $helper);
        return [false, 'Песочница недоступна', -1, false];
    }

    $startTime = microtime(true);
    $stdout = '';
    $stderr = '';
    $exitCode = -1;
    $timedOut = false;

    if ($isWindows) {
        // На Windows stream_select()/stream_set_blocking() не работают с pipe,
        // поэтому stdin/stdout/stderr передаём через временные файлы: иначе
        // бесконечный цикл в программе ученика «вешает» запрос навсегда.
        $inFile = tempnam(sys_get_temp_dir(), 'oge16_in_');
        $outFile = tempnam(sys_get_temp_dir(), 'oge16_out_');
        $errFile = tempnam(sys_get_temp_dir(), 'oge16_err_');
        file_put_contents($inFile, $stdinData);
        $descriptorspec = [
            0 => ['file', $inFile, 'r'],
            1 => ['file', $outFile, 'w'],
            2 => ['file', $errFile, 'w'],
        ];
        $process = proc_open($cmd, $descriptorspec, $pipes, null, null, ['bypass_shell' => true]);
        if (!is_resource($process)) {
            @unlink($inFile); @unlink($outFile); @unlink($errFile);
            return [false, 'Failed to start Python', -1, false];
        }
        while (true) {
            $status = proc_get_status($process);
            if (!($status['running'] ?? false)) {
                $exitCode = $status['exitcode'] ?? -1;
                break;
            }
            if (microtime(true) - $startTime >= $timeout) {
                proc_terminate($process, 9);
                $timedOut = true;
                usleep(100000);
                break;
            }
            usleep(20000);
        }
        proc_close($process);
        // Читаем файл порциями и сохраняем начало и хвост: sentinel-маркеры
        // находятся в начале и в конце, а память не растёт от «печатающих»
        // программ.
        $stdoutHead = '';
        $stdoutTail = '';
        $stdoutDropped = false;
        $fh = @fopen($outFile, 'rb');
        if ($fh) {
            while (!feof($fh)) {
                $chunk = fread($fh, 65536);
                if ($chunk === false || $chunk === '') break;
                oge_append_limited($stdoutHead, $stdoutTail, $stdoutDropped, $chunk);
            }
            fclose($fh);
        }
        $stdout = oge_finish_output($stdoutHead, $stdoutTail, $stdoutDropped);
        $stderr = (string)@file_get_contents($errFile);
        @unlink($inFile); @unlink($outFile); @unlink($errFile);
        return [$stdout, $stderr, $exitCode, $timedOut];
    }

    // Linux/macOS: пайпы + stream_select (там он штатно работает с pipe).
    $descriptorspec = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];
    $process = proc_open($cmd, $descriptorspec, $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($process)) {
        return [false, 'Failed to start Python', -1, false];
    }

    if ($stdinData !== '') {
        @fwrite($pipes[0], $stdinData);
    }
    fclose($pipes[0]);

    $stdoutHead = '';
    $stdoutTail = '';
    $stdoutDropped = false;

    while (true) {
        $status = proc_get_status($process);
        if (!($status['running'] ?? false)) {
            $exitCode = $status['exitcode'] ?? -1;
            oge_append_limited($stdoutHead, $stdoutTail, $stdoutDropped, (string)stream_get_contents($pipes[1]));
            $stderr .= stream_get_contents($pipes[2]);
            break;
        }
        $elapsed = microtime(true) - $startTime;
        if ($elapsed >= $timeout) {
            proc_terminate($process, 9);
            oge_append_limited($stdoutHead, $stdoutTail, $stdoutDropped, (string)stream_get_contents($pipes[1]));
            $stderr .= stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($process);
            $stdout = oge_finish_output($stdoutHead, $stdoutTail, $stdoutDropped);
            return [$stdout, $stderr, 124, true];
        }
        $read = [$pipes[1], $pipes[2]];
        $write = null; $except = null;
        $sel = @stream_select($read, $write, $except, max(0, (int)ceil($timeout - $elapsed)), 100000);
        if ($sel === false) {
            // Ошибка select — дочитываем буферы и завершаем.
            oge_append_limited($stdoutHead, $stdoutTail, $stdoutDropped, (string)stream_get_contents($pipes[1]));
            $stderr .= stream_get_contents($pipes[2]);
            break;
        }
        if ($sel > 0) {
            foreach ($read as $pipe) {
                $data = fread($pipe, 8192);
                if ($data === false || $data === '') continue;
                if ($pipe === $pipes[1]) {
                    oge_append_limited($stdoutHead, $stdoutTail, $stdoutDropped, $data);
                } else {
                    $stderr .= $data;
                }
            }
        }
    }

    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($process);
    $stdout = oge_finish_output($stdoutHead, $stdoutTail, $stdoutDropped);
    return [$stdout, $stderr, $exitCode, false];
}

/**
 * Копит вывод, сохраняя начало и хвост: sentinel-маркеры wrapper'а стоят
 * в начале и в конце, поэтому нельзя просто обрезать вывод по лимиту.
 */
function oge_append_limited(string &$head, string &$tail, bool &$dropped, string $data, int $headLimit = 2097152, int $tailLimit = 262144): void {
    if ($data === '') {
        return;
    }
    if (strlen($head) < $headLimit) {
        $room = $headLimit - strlen($head);
        $head .= substr($data, 0, $room);
        $data = (string)substr($data, $room);
    }
    if ($data === '') {
        return;
    }
    $dropped = true;
    $tail .= $data;
    if (strlen($tail) > $tailLimit) {
        $tail = substr($tail, -$tailLimit);
    }
}

/** Собирает начало, пометку об обрезке и хвост вывода. */
function oge_finish_output(string $head, string $tail, bool $dropped): string {
    if (!$dropped) {
        return $head;
    }
    return $head . "\n... [вывод превысил 2 МБ, показан фрагмент] ...\n" . $tail;
}

/** Извлекает stdout/stderr из sentinel-маркеров. */
function oge_parse_sentinels(string $rawStdout, string $sentinel): array {
    $sb = '_OGE_STDOUT_' . $sentinel . '_BEGIN_';
    $se = '_OGE_STDOUT_' . $sentinel . '_END_';
    $eb = '_OGE_STDERR_' . $sentinel . '_BEGIN_';
    $ee = '_OGE_STDERR_' . $sentinel . '_END_';

    $p1 = strpos($rawStdout, $sb);
    $p2 = strpos($rawStdout, $se);
    $p3 = strpos($rawStdout, $eb);
    $p4 = strpos($rawStdout, $ee);

    $stdout = ($p1 !== false && $p2 !== false && $p1 < $p2)
        ? substr($rawStdout, $p1 + strlen($sb), $p2 - $p1 - strlen($sb))
        : '';
    $stderr = ($p3 !== false && $p4 !== false && $p3 < $p4)
        ? substr($rawStdout, $p3 + strlen($eb), $p4 - $p3 - strlen($eb))
        : '';

    return ['stdout' => $stdout, 'stderr' => $stderr];
}

/** Убирает из сырого stderr пути файловой системы сервера. */
function oge_sanitize_stderr(string $stderr): string {
    $stderr = preg_replace('/\/(tmp|var\/tmp)\/[A-Za-z0-9._-]+/', '[file]', $stderr);
    $stderr = str_replace(sys_get_temp_dir(), '[temp]', $stderr);
    return $stderr;
}

/** Ограничение размера вывода. */
function oge_truncate(string $output): string {
    $max = 1048576;
    if (strlen($output) > $max) {
        return substr($output, 0, $max) . "\n\n... [вывод обрезан, слишком большой]";
    }
    return $output;
}
