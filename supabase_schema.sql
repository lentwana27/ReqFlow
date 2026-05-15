-- Supabase Schema for REQFLOW PRO - Production Update Only
-- Run this in the Supabase SQL Editor
-- This file uses IF NOT EXISTS to prevent accidental data loss.

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
  "sequenceNumber" TEXT, -- Added
  "processedNumber" TEXT, -- Added
  "amountIssued" NUMERIC, -- Added: Actual amount issued by Treasurer
  "changeReturned" NUMERIC, -- Added: Amount to be returned if issued > total
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
  "department" TEXT -- Added
);

-- 4. Password Recovery Tokens (For manual recovery link flow)
CREATE TABLE IF NOT EXISTS public.recovery_tokens (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "token" TEXT UNIQUE NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

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
      -- Specifically allow Treasurer and Finance HOD to update 'approved' requisitions to 'processed'
      (SELECT "role" FROM public.profiles WHERE "uid" = auth.uid()) IN ('Treasurer', 'Finance HOD', 'TREASURER', 'FINANCE_HOD', 'Accounting HOD', 'ACCOUNTING_HOD') 
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
