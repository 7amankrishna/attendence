<?php
// Copy this file to config.php and enter the exact values shown in
// InfinityFree Control Panel > MySQL Databases.

define('DB_HOST', 'sqlXXX.infinityfree.com'); // Never use localhost on InfinityFree
define('DB_NAME', 'if0_XXXXXXXX_rollflow');
define('DB_USER', 'if0_XXXXXXXX');
define('DB_PASS', 'YOUR_HOSTING_ACCOUNT_PASSWORD');

// Add every frontend that may call this API. Include the Vercel production URL,
// the InfinityFree domain, and localhost during development.
define('ALLOWED_ORIGINS', [
    'http://localhost:5173',
    'https://your-project.vercel.app',
    'https://your-site.infinityfreeapp.com'
]);

function corsOrigin(): string {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (in_array('*', ALLOWED_ORIGINS, true)) return '*';
    if ($origin && in_array($origin, ALLOWED_ORIGINS, true)) return $origin;
    return ALLOWED_ORIGINS[0] ?? '';
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ]);
    }
    return $pdo;
}

function jsonResponse(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: ' . corsOrigin());
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function handleOptions(): void {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        jsonResponse(['success' => true]);
    }
}

function readJson(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) jsonResponse(['success' => false, 'message' => 'Invalid JSON body'], 400);
    return $data;
}

function positiveInt($value, string $name): int {
    $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$number) jsonResponse(['success' => false, 'message' => "Invalid $name"], 422);
    return $number;
}

set_exception_handler(function (Throwable $e): void {
    error_log($e->getMessage());
    jsonResponse(['success' => false, 'message' => 'Server error. Check database settings and PHP error log.'], 500);
});
