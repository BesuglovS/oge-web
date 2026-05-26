<?php
/**
 * run_python.php - Запуск Python-кода для проверки заданий ОГЭ
 * Принимает: code (Python-код) и test_input (входные данные для stdin)
 * Возвращает: JSON с выводом, ошибками, результатом сравнения
 */

// Только POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('HTTP/1.1 405 Method Not Allowed');
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Only POST method allowed']);
    exit;
}

// Получаем данные
$code = isset($_POST['code']) ? $_POST['code'] : '';
$testInput = isset($_POST['test_input']) ? $_POST['test_input'] : '';
$expectedOutput = isset($_POST['expected_output']) ? $_POST['expected_output'] : '';

// Валидация
if (trim($code) === '') {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Код не может быть пустым']);
    exit;
}

// Ограничение размера кода (20 KB)
if (strlen($code) > 20480) {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Код слишком большой (максимум 20 KB)']);
    exit;
}

// Блокировка опасных модулей и функций
$dangerousPatterns = [
    '/\bos\b/',
    '/\bsubprocess\b/',
    '/\bshutil\b/',
    '/\bsys\b(?!\.stdin|\s*\.\s*stdout|\s*\.\s*stderr|\s*\.\s*argv)/',
    '/\bsocket\b/',
    '/\bctypes\b/',
    '/\bcompile\b/',
    '/\bexec\b/',
    '/\beval\b/',
    '/\b__import__\b/',
    '/\bopen\s*\(/',
    '/\bopenpty\b/',
    '/\bPopen\b/',
    '/\bfork\b/',
    '/\bexecve\b/',
    '/\bexecvp\b/',
    '/\bremove\b/',
    '/\brmdir\b/',
    '/\bunlink\b/',
    '/\bchmod\b/',
    '/\bchown\b/',
    '/\bkill\b/',
    '/\bexit\b(?!\s*\()/',
];

foreach ($dangerousPatterns as $pattern) {
    if (preg_match($pattern, $code)) {
        header('Content-Type: application/json');
        echo json_encode([
            'error' => 'Код содержит запрещённые операции. Используйте только базовый Python (input, print, циклы, условия).'
        ]);
        exit;
    }
}

// Создаем временные файлы
$tmpDir = sys_get_temp_dir();
$hash = md5(uniqid('oge16_', true));
$codeFile = $tmpDir . '/oge16_' . $hash . '.py';
$inputFile = $tmpDir . '/oge16_' . $hash . '.txt';

try {
    // Записываем код
    file_put_contents($codeFile, $code);

    // Записываем входные данные
    if ($testInput !== '') {
        file_put_contents($inputFile, $testInput);
    }

    // Команда запуска: python3 code.py < input.txt (если есть входные данные)
    $cmd = '/usr/bin/python3 ' . escapeshellarg($codeFile);
    if ($testInput !== '') {
        $cmd .= ' < ' . escapeshellarg($inputFile);
    }

    // Запускаем через shell_exec с таймаутом
    // Используем exec + временный файл для вывода, чтобы избежать проблем с proc_get_status
    $outputFile = $tmpDir . '/oge16_out_' . $hash . '.txt';
    $errorFile = $tmpDir . '/oge16_err_' . $hash . '.txt';

    // Формируем команду с перенаправлением вывода и таймаутом
    // timeout 5 python3 code.py < input.txt > output.txt 2> error.txt
    $fullCmd = 'timeout 5 ' . $cmd . ' > ' . escapeshellarg($outputFile) . ' 2> ' . escapeshellarg($errorFile);

    // Запускаем
    $exitCode = 0;
    $lastLine = exec($fullCmd, $cmdOutput, $exitCode);

    // Читаем вывод
    $stdout = '';
    if (file_exists($outputFile)) {
        $stdout = file_get_contents($outputFile);
        @unlink($outputFile);
    }
    $stderr = '';
    if (file_exists($errorFile)) {
        $stderr = file_get_contents($errorFile);
        @unlink($errorFile);
    }

    // Если exitCode = 124, это таймаут от команды timeout
    if ($exitCode === 124) {
        header('Content-Type: application/json');
        echo json_encode([
            'error' => '⏱️ Превышено время выполнения (5 сек). Проверьте, нет ли бесконечного цикла в вашей программе.',
            'timeout' => true
        ]);
        @unlink($codeFile);
        @unlink($inputFile);
        exit;
    }

    // Очищаем вывод
    $output = trim($stdout);
    $errorOutput = trim($stderr);

    // Сравниваем с ожидаемым результатом
    $matched = false;
    if ($expectedOutput !== '' && $output !== '') {
        $normalizedOutput = trim(preg_replace('/\s+/', ' ', $output));
        $normalizedExpected = trim(preg_replace('/\s+/', ' ', $expectedOutput));
        $matched = ($normalizedOutput === $normalizedExpected);
    }

    // Определяем результат
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

} catch (Exception $e) {
    header('Content-Type: application/json');
    echo json_encode(['error' => $e->getMessage()]);
} finally {
    @unlink($codeFile);
    @unlink($inputFile);
    @unlink($outputFile ?? '');
    @unlink($errorFile ?? '');
}