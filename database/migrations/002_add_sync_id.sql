alter table attendance_records
  add column sync_id char(36) null after note;

create index attendance_sync_lookup on attendance_records (sync_id);
