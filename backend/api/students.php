<?php
require_once __DIR__ . '/config.php';
handleOptions();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['success' => false, 'message' => 'Method not allowed'], 405);
}

$classId = positiveInt($_GET['class_id'] ?? 1, 'class_id');
$stmt = db()->prepare('SELECT id, roll_no, name, email FROM students WHERE class_id = ? AND active = 1 ORDER BY roll_no, name');
$stmt->execute([$classId]);

jsonResponse(['success' => true, 'students' => $stmt->fetchAll()]);
