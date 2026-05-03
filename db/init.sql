CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('USER', 'TEACHER', 'STAFF', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE booking_status AS ENUM ('CONFIRMED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE scan_result AS ENUM ('CHECKED_IN', 'WRONG_BASE', 'WRONG_TIME', 'REJECTED', 'MANUAL_CHECKED_IN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE qr_subject_type AS ENUM ('BOOKING', 'STUDENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text UNIQUE NOT NULL,
  display_name text,
  role user_role NOT NULL DEFAULT 'USER',
  school_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_number integer NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_event_id_base_number_key UNIQUE (event_id, base_number)
);

CREATE TABLE IF NOT EXISTS slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  capacity integer NOT NULL,
  booked_count integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  first_name text NOT NULL,
  last_name text NOT NULL,
  student_code text,
  class_room text,
  school_name text,
  qr_jti text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  student_id uuid REFERENCES students(id) ON DELETE RESTRICT,
  parent_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  slot_id uuid NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
  status booking_status NOT NULL DEFAULT 'CONFIRMED',
  qr_jti text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_owner_check CHECK (user_id IS NOT NULL OR student_id IS NOT NULL),
  CONSTRAINT bookings_user_id_slot_id_key UNIQUE (user_id, slot_id),
  CONSTRAINT bookings_student_id_slot_id_key UNIQUE (student_id, slot_id)
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  base_number integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS scan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  student_name text,
  actual_base_number integer NOT NULL,
  expected_base_number integer,
  expected_slot_start timestamptz,
  result scan_result NOT NULL,
  is_override boolean NOT NULL DEFAULT false,
  is_manual boolean NOT NULL DEFAULT false,
  staff_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  staff_session_id uuid REFERENCES staff_sessions(id) ON DELETE SET NULL,
  qr_subject_type qr_subject_type,
  qr_subject_id uuid,
  note text
);

CREATE INDEX IF NOT EXISTS activities_event_id_is_active_idx ON activities(event_id, is_active);
CREATE INDEX IF NOT EXISTS slots_activity_id_is_visible_idx ON slots(activity_id, is_visible);
CREATE INDEX IF NOT EXISTS slots_start_time_idx ON slots(start_time);
CREATE INDEX IF NOT EXISTS students_teacher_id_idx ON students(teacher_id);
CREATE INDEX IF NOT EXISTS students_school_name_class_room_idx ON students(school_name, class_room);
CREATE INDEX IF NOT EXISTS students_first_name_last_name_idx ON students(first_name, last_name);
CREATE INDEX IF NOT EXISTS bookings_slot_id_status_idx ON bookings(slot_id, status);
CREATE INDEX IF NOT EXISTS bookings_user_id_idx ON bookings(user_id);
CREATE INDEX IF NOT EXISTS bookings_student_id_idx ON bookings(student_id);
CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_ended_at_idx ON staff_sessions(staff_id, ended_at);
CREATE INDEX IF NOT EXISTS staff_sessions_base_number_ended_at_idx ON staff_sessions(base_number, ended_at);
CREATE INDEX IF NOT EXISTS scan_logs_actual_base_number_result_idx ON scan_logs(actual_base_number, result);
CREATE INDEX IF NOT EXISTS scan_logs_student_id_idx ON scan_logs(student_id);
CREATE INDEX IF NOT EXISTS scan_logs_booking_id_idx ON scan_logs(booking_id);
CREATE INDEX IF NOT EXISTS scan_logs_staff_session_id_idx ON scan_logs(staff_session_id);
CREATE INDEX IF NOT EXISTS scan_logs_scanned_at_idx ON scan_logs(scanned_at);
