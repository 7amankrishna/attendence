<?php
require_once __DIR__ . '/config.php';
handleOptions();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['success' => false, 'message' => 'Method not allowed'], 405);
}

$classId = positiveInt($_GET['class_id'] ?? 1, 'class_id');
$days = min(10, max(1, (int)($_GET['days'] ?? 5)));
$pdo = db();

$dateStmt = $pdo->prepare('SELECT DISTINCT attendance_date FROM attendance_records WHERE class_id = ? ORDER BY attendance_date DESC LIMIT ' . $days);
$dateStmt->execute([$classId]);
$dates = array_reverse(array_column($dateStmt->fetchAll(), 'attendance_date'));

if (!$dates) jsonResponse(['success' => true, 'dates' => [], 'students' => []]);

$placeholders = implode(',', array_fill(0, count($dates), '?'));
$sql = "SELECT s.id AS student_id, s.name, s.roll_no, a.attendance_date, a.status
        FROM students s
        LEFT JOIN attendance_records a ON a.student_id = s.id AND a.class_id = s.class_id AND a.attendance_date IN ($placeholders)
        WHERE s.class_id = ? AND s.active = 1
        ORDER BY s.roll_no, s.name, a.attendance_date";
$stmt = $pdo->prepare($sql);
$stmt->execute([...$dates, $classId]);

$students = [];
foreach ($stmt->fetchAll() as $row) {
    $id = (int)$row['student_id'];
    if (!isset($students[$id])) {
        $students[$id] = ['student_id' => $id, 'name' => $row['name'], 'roll_no' => $row['roll_no'], 'by_date' => []];
    }
    if ($row['attendance_date']) $students[$id]['by_date'][$row['attendance_date']] = $row['status'];
}

$result = [];
foreach ($students as $student) {
    $statuses = array_map(fn($date) => $student['by_date'][$date] ?? null, $dates);
    $result[] = ['student_id' => $student['student_id'], 'name' => $student['name'], 'roll_no' => $student['roll_no'], 'statuses' => $statuses];
}

jsonResponse([
    'success' => true,
    'dates' => array_map(fn($d) => date('M d', strtotime($d)), $dates),
    'students' => $result
]);
