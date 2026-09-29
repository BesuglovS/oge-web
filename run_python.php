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

// ─── 2. Rate-limit по IP (файловый, flock) ───
oge_rate_limit();

function oge_rate_limit(int $limit = 10, int $window = 60): void {
    // Каталог rate-limit — вне webroot: webroot принадлежит deploy
    // (www-data не имеет права записи, это часть изоляции).
    $dir = sys_get_temp_dir() . '/oge-sandbox-ratelimit';
    @mkdir($dir, 0700, true);
    if (!is_dir($dir)) {
        return; // каталог недоступен — не блокируем работу эндпоинта
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

// ─── 4. Pre-фильтры (слой 2) ───
$allowedModules = ['math', 'random', 'datetime', 'decimal', 'fractions', 'string', 're', 'collections', 'itertools', 'functools', 'operator', 'json', 'csv'];

$forbiddenPatterns = [
    '/\b__import__\b/',
    '/\b__builtins__\b/',
    '/\b__import_attr__\b/',
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

foreach ($forbiddenPatterns as $pattern) {
    if (preg_match($pattern, $code)) {
        header('Content-Type: application/json');
        echo json_encode([
            'error' => 'Код содержит запрещённые операции. Используйте только print, переменные, условия, циклы и разрешённые модули (math, random, datetime).'
        ]);
        exit;
    }
}

if (preg_match_all('/\bimport\s+([a-zA-Z_][a-zA-Z0-9_]*)/', $code, $matches)) {
    foreach ($matches[1] as $module) {
        if (!in_array($module, $allowedModules, true)) {
            header('Content-Type: application/json');
            echo json_encode([
                'error' => "Модуль '$module' запрещён. Разрешённые модули: " . implode(', ', $allowedModules)
            ]);
            exit;
        }
    }
}
if (preg_match_all('/\bfrom\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+import/', $code, $matches)) {
    foreach ($matches[1] as $module) {
        if (!in_array($module, $allowedModules, true)) {
            header('Content-Type: application/json');
            echo json_encode([
                'error' => "Модуль '$module' запрещён. Разрешённые модули: " . implode(', ', $allowedModules)
            ]);
            exit;
        }
    }
}

// ─── 5. Wrapper с усечёнными builtins (слой 3) ───
$sentinel = bin2hex(random_bytes(16));
$encoded = base64_encode($code);
$wrapper = oge_build_wrapper($encoded, $sentinel);

/**
 * Wrapper: exec(compile(base64-код)) в namespace с усечёнными builtins.
 * Защита в глубину: без open/eval/exec/getattr и импортов вне белого списка.
 */
function oge_build_wrapper(string $encoded, string $sentinel): string {
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
    'open', 'exec', 'eval', 'compile',
    'getattr', 'setattr', 'delattr', 'hasattr',
    'globals', 'locals', 'vars', 'dir',
    'type', 'isinstance', 'issubclass', 'callable',
    'help', 'memoryview', 'exit', 'quit',
})
_oge_allowed = frozenset({
    'math', 'random', 'datetime', 'itertools', 'collections',
    'functools', 'operator', 'json', 're', 'string',
    'decimal', 'fractions', 'csv',
})
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
        ['%CODE%', '%STDOUT_BEGIN%', '%STDOUT_END%', '%STDERR_BEGIN%', '%STDERR_END%'],
        [$encoded, $stdoutBegin, $stdoutEnd, $stderrBegin, $stderrEnd],
        $template
    );
}

// ─── 6. Выполнение (слой 4: изоляция через sudo-хелпер или RLIMIT prelude) ───
$tmpFile = tempnam(sys_get_temp_dir(), 'oge16_');
file_put_contents($tmpFile, $wrapper);

const OGE_MEMORY_LIMIT_MB = 128;
const OGE_TIMEOUT_SEC = 5;

$memBytes = OGE_MEMORY_LIMIT_MB * 1024 * 1024;
list($rawStdout, $rawStderr, $exitCode) = oge_run($tmpFile, $testInput, OGE_TIMEOUT_SEC, OGE_MEMORY_LIMIT_MB);
@unlink($tmpFile);

$timedOut = ($exitCode === 124);

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
$matched = false;
if ($expectedOutput !== '' && $output !== '') {
    $normalizedOutput = trim(preg_replace('/\s+/', ' ', $output));
    $normalizedExpected = trim(preg_replace('/\s+/', ' ', $expectedOutput));
    $matched = ($normalizedOutput === $normalizedExpected);
}

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
 * Запускает скрипт: через изолирующий sudo-хелпер (если установлен),
 * либо напрямую python3 -I -S с RLIMIT-префиксом в скрипте (dev-fallback).
 */
function oge_run(string $tmpFile, string $stdinData, int $timeout, int $memoryMb): array {
    $memBytes = $memoryMb * 1024 * 1024;
    $helper = getenv('SANDBOX_RUN_HELPER');
    if ($helper === false || $helper === '') {
        $helper = '/usr/local/sbin/sandbox-python.run';
    }

    $descriptorspec = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];

    $argvBase = DIRECTORY_SEPARATOR === '\\'
        ? ['py', '-3']
        : ['/usr/bin/python3'];

    if (DIRECTORY_SEPARATOR !== '\\' && is_file($helper) && is_executable($helper)) {
        // Изоляция: root-хелпер -> unshare -> sandbox user -> prlimit
        $cmd = array_merge(
            ['/usr/bin/sudo', '-n', '--', $helper],
            [$tmpFile, (string)$memoryMb, (string)$timeout, '/usr/bin/python3']
        );
        @chmod($tmpFile, 0644);
    } else {
        // Fallback без хелпера: RLIMIT-префикс в скрипте + хард-токаут процесса
        // через proc_terminate() в цикле ожидания ниже.
        $script = (string) file_get_contents($tmpFile);
        $prelude =
            "try:\n" .
            "    import resource\n" .
            "    resource.setrlimit(resource.RLIMIT_AS, ($memBytes, $memBytes))\n" .
            "except (ImportError, ValueError, OSError):\n" .
            "    pass\n";
        file_put_contents($tmpFile, $prelude . $script);
        $cmd = array_merge($argvBase, ['-I', '-S', '-X', 'utf8', $tmpFile]);
    }

    $process = proc_open($cmd, $descriptorspec, $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($process)) {
        return [false, 'Failed to start Python', -1];
    }

    if ($stdinData !== '') {
        @fwrite($pipes[0], $stdinData);
    }
    fclose($pipes[0]);

    $startTime = microtime(true);
    $stdout = '';
    $stderr = '';
    $exitCode = -1;

    while (true) {
        $status = proc_get_status($process);
        if (!($status['running'] ?? false)) {
            $exitCode = $status['exitcode'] ?? -1;
            $stdout .= stream_get_contents($pipes[1]);
            $stderr .= stream_get_contents($pipes[2]);
            break;
        }
        $elapsed = microtime(true) - $startTime;
        if ($elapsed >= $timeout) {
            proc_terminate($process, 9);
            $stdout .= stream_get_contents($pipes[1]);
            $stderr .= stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($process);
            return [$stdout, $stderr, 124];
        }
        $read = [$pipes[1], $pipes[2]];
        $write = null; $except = null;
        $sel = @stream_select($read, $write, $except, max(0, ceil($timeout - $elapsed)), 100000);
        if ($sel === false) {
            break;
        }
        if ($sel > 0) {
            foreach ($read as $pipe) {
                $data = fread($pipe, 8192);
                if ($data === false || $data === '') continue;
                if ($pipe === $pipes[1]) { $stdout .= $data; } else { $stderr .= $data; }
            }
        }
    }

    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($process);
    return [$stdout, $stderr, $exitCode];
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
