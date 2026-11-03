CREATE TABLE classes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  subject VARCHAR(120) DEFAULT NULL,
  section VARCHAR(40) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE students (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id INT UNSIGNED NOT NULL,
  roll_no VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) DEFAULT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_roll_per_class (class_id, roll_no),
  CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  status ENUM('present','absent','late','excused') NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY one_record_per_day (class_id, student_id, attendance_date),
  KEY class_date_lookup (class_id, attendance_date),
  CONSTRAINT fk_attendance_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO classes (id, name, subject, section) VALUES
(1, 'B.Tech CSE', 'Computer Networks', 'H(G1)');

INSERT INTO students (class_id, roll_no, name) VALUES
(1,'24CS001','Aarav Sharma'),(1,'24CS002','Aditi Singh'),(1,'24CS003','Aditya Raj'),
(1,'24CS004','Ananya Verma'),(1,'24CS005','Ankit Kumar'),(1,'24CS006','Arjun Mehta'),
(1,'24CS007','Aryan Asthana'),(1,'24CS008','Avni Gupta'),(1,'24CS009','Deepak Yadav'),
(1,'24CS010','Diya Roy'),(1,'24CS011','Harsh Raj'),(1,'24CS012','Ishita Jain'),
(1,'24CS013','Kabir Khan'),(1,'24CS014','Kavya Mishra'),(1,'24CS015','Meera Joshi'),
(1,'24CS016','Nikhil Das'),(1,'24CS017','Priya Kumari'),(1,'24CS018','Raghav Sinha'),
(1,'24CS019','Riya Patel'),(1,'24CS020','Rohan Kumar'),(1,'24CS021','Sakshi Jha'),
(1,'24CS022','Samarth Rao'),(1,'24CS023','Sneha Nair'),(1,'24CS024','Tanvi Kapoor'),
(1,'24CS025','Vihaan Gupta');
