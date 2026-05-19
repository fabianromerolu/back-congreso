ALTER TABLE "asistencias_registros"
ADD COLUMN IF NOT EXISTS "certificateUrl" TEXT;

ALTER TABLE "asistencias_registros"
ADD COLUMN IF NOT EXISTS "certificatePublicId" TEXT;