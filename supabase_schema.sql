-- Supabase Schema for REQFLOW PRO - Production Update Only
-- Run this in the Supabase SQL Editor
-- This file uses IF NOT EXISTS to prevent accidental data loss. It never drops tables or deletes existing user data.

-- 1. Profiles Table (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  "uid" UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  "username" TEXT UNIQUE NOT NULL,
  "email" TEXT UNIQUE,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "status" TEXT DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved')),
  "isVerified" BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Requisitions Table
CREATE TABLE IF NOT EXISTS public.requisitions (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "requisitionNumber" TEXT NOT NULL,
  "sequenceNumber" TEXT,
  "processedNumber" TEXT,
  "amountIssued" NUMERIC, -- Actual amount issued by Treasurer
  "changeReturned" NUMERIC, -- Amount to be returned if issued > total
  "amountToReturn" NUMERIC, -- Amount user wants to return
  "returnStatus" TEXT DEFAULT 'none', -- none, pending, confirmed
  "type" TEXT NOT NULL,
  "creatorId" UUID REFERENCES public.profiles("uid") ON DELETE CASCADE NOT NULL,
  "creatorName" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "items" JSONB NOT NULL, -- Array of RequisitionItems
  "writtenTo" TEXT,
  "currency" TEXT DEFAULT 'USD',
  "attachments" JSONB DEFAULT '[]',
  "notes" TEXT,
  "rejectionReason" TEXT,
  "quotationBook" TEXT,
  "totalAmount" NUMERIC NOT NULL,
  "status" TEXT DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'processed')),
  "currentStage" INTEGER DEFAULT 0,
  "involvedRoles" TEXT[] NOT NULL,
  "approvals" JSONB NOT NULL, -- Array of Approval objects
  "issuedInfo" JSONB, -- Final issuance info
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Activity Logs Table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp" TIMESTAMPTZ DEFAULT NOW(),
  "user" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "target" TEXT,
  "details" TEXT,
  "requisitionId" UUID REFERENCES public.requisitions("id") ON DELETE CASCADE,
  "userId" UUID REFERENCES public.profiles("uid") ON DELETE CASCADE,
  "department" TEXT
);

-- 4. Settings Table
CREATE TABLE IF NOT EXISTS public.settings (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedBy" TEXT
);

-- 5. Password Recovery Tokens (For manual recovery link flow)
CREATE TABLE IF NOT EXISTS public.recovery_tokens (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "token" TEXT UNIQUE NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Incremental Schema Upgrades (Upgrades existing schemas in-place without deleting any data)
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "sequenceNumber" TEXT;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "processedNumber" TEXT;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "amountIssued" NUMERIC;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "changeReturned" NUMERIC;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "amountToReturn" NUMERIC;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "returnStatus" TEXT DEFAULT 'none';
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "returnType" TEXT;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'USD';
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "attachments" JSONB DEFAULT '[]';
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "quotationBook" TEXT;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS "issuedInfo" JSONB;

-- Speed Optimizations & Performance Patch (Makes user log in, verification, and loading tables significantly faster)
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_requisitions_creator_id ON public.requisitions("creatorId");
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON public.requisitions(status);
CREATE INDEX IF NOT EXISTS idx_requisitions_return_status ON public.requisitions("returnStatus");
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs("userId");
CREATE INDEX IF NOT EXISTS idx_activity_logs_requisition_id ON public.activity_logs("requisitionId");
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON public.activity_logs("timestamp");

-- ── 1. AUTH / LOGIN SPEEDUP ──
-- Composite indexes for lightning fast profile lookup on active profile status checks
CREATE INDEX IF NOT EXISTS idx_profiles_uid_status ON public.profiles ("uid", "status", "isVerified");
-- Lowercase username logins (prevents table scans on case-insensitive logins)
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles (LOWER("username"));

-- ── 2. REQUISITIONS TABLE QUERY OPTIMIZATIONS ──
-- Compound index covering most dashboard lists filtering by creator and status
CREATE INDEX IF NOT EXISTS idx_req_creator_status ON public.requisitions ("creatorId", "status");
-- Role-based inbox queries: GIN index allows fast array containment checks for involvedRoles matching
CREATE INDEX IF NOT EXISTS idx_req_involved_roles ON public.requisitions USING GIN ("involvedRoles");
-- Filtered partial index for active return workflows only
CREATE INDEX IF NOT EXISTS idx_req_return_status_filtered ON public.requisitions ("returnStatus") WHERE "returnStatus" != 'none';
-- Absolute order query performance improvement (newest first)
CREATE INDEX IF NOT EXISTS idx_req_created_desc ON public.requisitions ("createdAt" DESC);
-- Partial index covering active, non-historical requisitions only
CREATE INDEX IF NOT EXISTS idx_req_active_only ON public.requisitions ("creatorId", "currentStage") WHERE "status" IN ('pending', 'approved');

-- ── 3. ACTIVITY LOGS SPEEDUP ──
-- Highly optimized indexes covering matching by user/requisition with desc ordering (keeps recent queries fast)
CREATE INDEX IF NOT EXISTS idx_logs_recent_by_user ON public.activity_logs ("userId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_logs_recent_by_req ON public.activity_logs ("requisitionId", "timestamp" DESC);
-- Module filters for audit tables
CREATE INDEX IF NOT EXISTS idx_logs_module_timestamp ON public.activity_logs ("module", "timestamp" DESC);

-- ── 4. COLD DATA ARCHIVE STRUCTURE ──
-- Create background storage for historical activity logs if database size increases (Safe & Isolated)
CREATE TABLE IF NOT EXISTS public.activity_logs_archive (
  LIKE public.activity_logs INCLUDING ALL
);

-- ── 5. RUN ANALYZE ON MODIFIED TABLES (Tells Postgres query planner to refresh stats) ──
ANALYZE public.profiles;
ANALYZE public.requisitions;
ANALYZE public.activity_logs;

-- RLS (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
CREATE POLICY "Users can insert their own profile." ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = "uid");

DROP POLICY IF EXISTS "Users and admins can update profiles." ON public.profiles;
CREATE POLICY "Users and admins can update profiles." ON public.profiles
  FOR UPDATE USING (
    auth.uid() = "uid" OR 
    EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = auth.uid() AND "role" IN ('System Administrator', 'Admin'))
  );

DROP POLICY IF EXISTS "Admins can delete profiles." ON public.profiles;
CREATE POLICY "Admins can delete profiles." ON public.profiles
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = auth.uid() AND "role" IN ('System Administrator', 'Admin'))
  );

-- Requisitions Policies
DROP POLICY IF EXISTS "Public can view individual requisitions for verification." ON public.requisitions;
CREATE POLICY "Public can view individual requisitions for verification." ON public.requisitions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users and admins can view relevant requisitions." ON public.requisitions;
CREATE POLICY "Users and admins can view relevant requisitions." ON public.requisitions
  FOR SELECT USING (
    auth.uid() = "creatorId" OR 
    (SELECT "role" FROM public.profiles WHERE "uid" = auth.uid()) = ANY("involvedRoles") OR
    EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = auth.uid() AND "role" IN ('System Administrator', 'Admin', 'ADMIN', 'Director', 'Treasurer', 'Finance HOD', 'TREASURER', 'FINANCE_HOD', 'Accounting HOD'))
  );

DROP POLICY IF EXISTS "Users can create requisitions." ON public.requisitions;
CREATE POLICY "Users can create requisitions." ON public.requisitions
  FOR INSERT WITH CHECK (auth.uid() = "creatorId");

DROP POLICY IF EXISTS "Users and admins can update requisitions." ON public.requisitions;
CREATE POLICY "Users and admins can update requisitions." ON public.requisitions
  FOR UPDATE USING (
    (auth.uid() = "creatorId" AND "status" = 'pending') OR
    (SELECT "role" FROM public.profiles WHERE "uid" = auth.uid()) = ANY("involvedRoles") OR
    EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = auth.uid() AND "role" IN ('System Administrator', 'Admin', 'ADMIN')) OR
    (
      -- Specifically allow Treasurer to update 'approved' requisitions to 'processed'
      (SELECT "role" FROM public.profiles WHERE "uid" = auth.uid()) IN ('Treasurer', 'TREASURER') 
      AND "status" IN ('approved', 'processed')
    )
  );

DROP POLICY IF EXISTS "Admins and creators can delete requisitions." ON public.requisitions;
CREATE POLICY "Admins and creators can delete requisitions." ON public.requisitions
  FOR DELETE USING (
    (auth.uid() = "creatorId" AND "status" = 'pending') OR
    EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = auth.uid() AND "role" IN ('System Administrator', 'Admin'))
  );

-- Logs Policies
DROP POLICY IF EXISTS "Public can insert help requests and auth events." ON public.activity_logs;
CREATE POLICY "Public can insert help requests and auth events." ON public.activity_logs
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view logs." ON public.activity_logs;
CREATE POLICY "Authenticated users can view logs." ON public.activity_logs
  FOR SELECT USING (auth.role() = 'authenticated');

-- Settings Policies
DROP POLICY IF EXISTS "Settings are viewable by everyone." ON public.settings;
CREATE POLICY "Settings are viewable by everyone." ON public.settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can update settings." ON public.settings;
CREATE POLICY "Admins can update settings." ON public.settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = auth.uid() AND "role" IN ('System Administrator', 'Admin'))
  );

-- 6. Seed Master Admin Accounts Safely (if they do not already exist)
-- This block ensures we NEVER overwrite or drop existing users.
-- We use standard postgres extensions to create auth.users and public.profiles.

DO $$
DECLARE
  new_admin_id UUID := '00000000-0000-0000-0000-000000000001';
  new_admin1_id UUID := '00000000-0000-0000-0000-000000000002';
  admin_pass_hash TEXT;
  admin1_pass_hash TEXT;
BEGIN
  -- Generate hashes using pgcrypto if available, otherwise fallback to standard values
  -- Supabase Auth uses bcrypt (bf format)
  BEGIN
    admin_pass_hash := extensions.crypt('Admin50$', extensions.gen_salt('bf', 10));
    admin1_pass_hash := extensions.crypt('Action50$', extensions.gen_salt('bf', 10));
  EXCEPTION WHEN OTHERS THEN
    -- Fallbacks
    admin_pass_hash := '$2a$10$fV3cZqenD45vP.0f3F7fFe6E1r4aD46A6OAGFeM1S4AeD46A6OAG.';
    admin1_pass_hash := '$2a$10$R.UvbyA6lZ54Z6E8u2Z.Uun1EZrFe46OAGFeM1S4AeD46A6OAG.';
  END;

  -- Insert 'admin' auth user if not exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@reqflow-mail.com') THEN
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud,
      confirmation_token
    ) VALUES (
      new_admin_id,
      '00000000-0000-0000-0000-000000000000',
      'admin@reqflow-mail.com',
      admin_pass_hash,
      now(),
      '{"provider": "email", "providers": ["email"]}',
      '{"name": "System Administrator", "username": "admin", "role": "System Administrator", "department": "General"}',
      now(),
      now(),
      'authenticated',
      'authenticated',
      ''
    );

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = new_admin_id) THEN
      INSERT INTO public.profiles (
        uid,
        username,
        email,
        name,
        role,
        department,
        status,
        "isVerified",
        "createdAt",
        "updatedAt"
      ) VALUES (
        new_admin_id,
        'admin',
        'admin@reqflow-mail.com',
        'System Administrator',
        'System Administrator',
        'General',
        'approved',
        true,
        now(),
        now()
      );
    END IF;
  END IF;

  -- Insert 'admin1' auth user if not exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin1@reqflow-mail.com') THEN
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud,
      confirmation_token
    ) VALUES (
      new_admin1_id,
      '00000000-0000-0000-0000-000000000000',
      'admin1@reqflow-mail.com',
      admin1_pass_hash,
      now(),
      '{"provider": "email", "providers": ["email"]}',
      '{"name": "System Administrator 1", "username": "admin1", "role": "System Administrator", "department": "General"}',
      now(),
      now(),
      'authenticated',
      'authenticated',
      ''
    );

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE "uid" = new_admin1_id) THEN
      INSERT INTO public.profiles (
        uid,
        username,
        email,
        name,
        role,
        department,
        status,
        "isVerified",
        "createdAt",
        "updatedAt"
      ) VALUES (
        new_admin1_id,
        'admin1',
        'admin1@reqflow-mail.com',
        'System Administrator 1',
        'System Administrator',
        'General',
        'approved',
        true,
        now(),
        now()
      );
    END IF;
  END IF;
END $$;
