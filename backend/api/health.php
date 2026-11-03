<?php
require_once __DIR__ . '/config.php';
handleOptions();

$pdo = db();
$pdo->query('SELECT 1');
jsonResponse(['success' => true, 'message' => 'PHP API and MySQL are connected']);
