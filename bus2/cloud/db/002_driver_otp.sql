ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_control_otp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_control_otp_updated_at BIGINT;
