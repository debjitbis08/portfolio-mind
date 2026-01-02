-- Add Screener configuration to user_settings
ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS screener_email TEXT,
ADD COLUMN IF NOT EXISTS screener_password_encrypted TEXT,
ADD COLUMN IF NOT EXISTS screener_urls TEXT[] DEFAULT '{}';
