<?php
require_once __DIR__ . '/config.php';
handleOptions();

$pdo = db();
$allowed = ['present', 'absent', 'late', 'excused'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $classId = positiveInt($_GET['class_id'] ?? 1, 'class_id');
    $date = $_GET['date'] ?? date('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) jsonResponse(['success' => false, 'message' => 'Invalid date'], 422);

    $stmt = $pdo->prepare('SELECT student_id, status, note FROM attendance_records WHERE class_id = ? AND attendance_date = ?');
    $stmt->execute([$classId, $date]);
    jsonResponse(['success' => true, 'date' => $date, 'records' => $stmt->fetchAll()]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = readJson();
    $classId = positiveInt($body['class_id'] ?? null, 'class_id');
    $date = $body['date'] ?? date('Y-m-d');
    $records = $body['records'] ?? [];
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) jsonResponse(['success' => false, 'message' => 'Invalid date'], 422);
    if (!is_array($records)) jsonResponse(['success' => false, 'message' => 'records must be an array'], 422);

    $sql = 'INSERT INTO attendance_records (class_id, student_id, attendance_date, status, note)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), updated_at = CURRENT_TIMESTAMP';
    $stmt = $pdo->prepare($sql);

    $pdo->beginTransaction();
    try {
        $saved = 0;
        foreach ($records as $record) {
            $studentId = positiveInt($record['student_id'] ?? null, 'student_id');
            $status = $record['status'] ?? '';
            if (!in_array($status, $allowed, true)) {
                throw new InvalidArgumentException('Invalid attendance status');
            }
            $note = isset($record['note']) ? trim((string)$record['note']) : null;
            $stmt->execute([$classId, $studentId, $date, $status, $note]);
            $saved++;
        }
        $pdo->commit();
        jsonResponse(['success' => true, 'message' => 'Attendance saved', 'saved' => $saved]);
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

jsonResponse(['success' => false, 'message' => 'Method not allowed'], 405);
