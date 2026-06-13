<?php
/**
 * Прокси-скрипт для Overpass API
 * Используется для обхода CORS-ограничений из клиентского JavaScript.
 * 
 * Использование: overpass-proxy.php?q=[query]
 * где query — Overpass QL запрос.
 */

// CORS-заголовки для доступа с любого источника
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Обработка preflight-запроса
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Проверяем наличие параметра q
$query = isset($_GET['q']) ? $_GET['q'] : '';
if (!$query) {
    http_response_code(400);
    echo json_encode([
        'error' => 'Missing required parameter: q',
        'usage' => 'overpass-proxy.php?q=[Overpass QL query]'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Формируем URL к Overpass API
$url = 'https://overpass-api.de/api/interpreter?data=' . urlencode($query);

// Выполняем запрос к Overpass
$response = @file_get_contents($url, false, stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 20,
        'header' => "User-Agent: route-map-overpass-proxy/1.0\r\n"
    ],
    'ssl' => [
        'verify_peer' => false,
        'verify_peer_name' => false
    ]
]));

if ($response === false) {
    http_response_code(502);
    echo json_encode([
        'error' => 'Failed to fetch from Overpass API',
        'detail' => error_get_last()['message'] ?? 'Unknown error'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Возвращаем ответ от Overpass
echo $response;