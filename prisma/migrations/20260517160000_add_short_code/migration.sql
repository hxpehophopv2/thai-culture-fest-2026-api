-- Add short_code column to participants and students for manual check-in
-- Short code: 5-character alphanumeric (e.g. "A3K9F") for quick staff manual entry

ALTER TABLE "participants" ADD COLUMN "short_code" TEXT;
ALTER TABLE "students" ADD COLUMN "short_code" TEXT;

-- Create unique indexes
CREATE UNIQUE INDEX "participants_short_code_key" ON "participants"("short_code");
CREATE UNIQUE INDEX "students_short_code_key" ON "students"("short_code");
