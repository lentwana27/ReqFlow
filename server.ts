import express from 'express';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const app = express();
app.use(express.json({ limit: '10mb' })); // Increase limit for logo upload

// --- ROUTES ---

// Logo Upload
app.post('/api/upload-logo', async (req, res) => {
  const { logoData } = req.body;
  if (!logoData) {
    return res.status(400).json({ error: 'No logo data provided' });
  }

  try {
    const base64Data = logoData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    
    const publicDir = path.join(process.cwd(), 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    const logoPath = path.join(publicDir, 'logo.png');
    fs.writeFileSync(logoPath, buffer);
    
    console.log('[Branding] Logo updated at:', logoPath);
    res.json({ success: true, message: 'Logo updated successfully' });
  } catch (err: any) {
    console.error('[Branding] Upload error:', err);
    res.status(500).json({ error: 'Failed to save logo file: ' + err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'MINEAZY REQFLOW', environment: process.env.NODE_ENV || 'development' });
});

// System Status for Admin
app.get('/api/system/status', (req, res) => {
  const hasResend = !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.length > 20;
  const hasSupabaseServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fromEmail = process.env.VERIFIED_FROM_EMAIL || 'onboarding@resend.dev';
  
  res.json({
    email: {
      status: hasResend ? 'Active' : 'Simulation Mode',
      configured: hasResend,
      from: fromEmail,
      isSandbox: fromEmail === 'onboarding@resend.dev'
    },
    auth: {
      adminResets: hasSupabaseServiceRole ? 'Enabled' : 'Disabled',
      configured: hasSupabaseServiceRole
    }
  });
});

// Admin Password Reset
app.post('/api/admin/reset-password', async (req, res) => {
  const { userId, newPassword } = req.body;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.warn('[Admin Auth] SUPABASE_SERVICE_ROLE_KEY missing. Admin password reset unavailable.');
    return res.status(503).json({ 
      error: 'System not configured for automated password resets.',
      hint: 'Please provide SUPABASE_SERVICE_ROLE_KEY in the application settings.'
    });
  }

  try {
    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    let { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword
    });

    if (error) {
      const errMessage = error.message || '';
      if (errMessage.toLowerCase().includes('user not found') || errMessage.toLowerCase().includes('not found') || error.status === 404) {
        console.log(`[Admin Auth] User ${userId} not found in Auth. Attempting to recreate...`);
        const isUser1 = userId === '00000000-0000-0000-0000-000000000001';
        const isUser2 = userId === '00000000-0000-0000-0000-000000000002';
        
        if (isUser1 || isUser2) {
          const username = isUser2 ? 'admin1' : 'admin';
          const email = `${username}@reqflow-mail.com`;
          
          const { error: createError } = await supabaseAdmin.auth.admin.createUser({
            id: userId,
            email,
            password: newPassword,
            email_confirm: true,
            user_metadata: {
              name: username === 'admin1' ? 'System Administrator 1' : 'System Administrator',
              username,
              role: 'System Administrator',
              department: 'General'
            }
          });
          
          if (createError) throw createError;
          console.log(`[Admin Auth] User ${username} successfully recreated with ID ${userId}`);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    console.log(`[Admin Auth] Password successfully reset for user: ${userId}`);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: any) {
    console.error('[Admin Auth] Reset password error:', err);
    res.status(500).json({ error: err.message || 'Failed to update password' });
  }
});

// Manual Password Reset Request
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!url || !serviceRoleKey || !resendApiKey) {
    console.error('[Auth] Missing configuration for password reset');
    return res.status(503).json({ error: 'System not configured for password resets.' });
  }

  try {
    const supabaseAdmin = createClient(url, serviceRoleKey);
    
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.listUsers();
    const targetUser = (userData?.users as any[])?.find(u => u.email === email);
    
    if (!targetUser) {
      return res.json({ success: true, message: 'If an account exists for this email, a reset link has been sent.' });
    }

    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    const { error: tokenError } = await supabaseAdmin
      .from('recovery_tokens')
      .insert([{ email, token, expiresAt: expiresAt.toISOString() }]);

    if (tokenError) throw tokenError;

    const resend = new Resend(resendApiKey.replace(/\s/g, ""));
    
    let origin = process.env.VITE_APP_URL || req.headers.origin || `https://${req.headers.host}`;
    origin = origin.replace(/\/$/, '');
    
    if (origin.includes('-dev-') && !process.env.VITE_APP_URL) {
      origin = origin.replace('-dev-', '-pre-');
    }
    
    const recoveryLink = `${origin}/?recoveryToken=${token}&email=${encodeURIComponent(email)}`;
    const fromEmail = process.env.VERIFIED_FROM_EMAIL || 'ReqFlow Pro <onboarding@resend.dev>';
    
    await resend.emails.send({
      from: fromEmail,
      to: [email],
      subject: 'Reset Your ReqFlow Pro Password',
      text: `Hello,\n\nYou recently requested to reset your password for Mineazy ReqFlow.\n\nTo reset your password, please follow the link below (valid for 1 hour):\n${recoveryLink}\n\nIf you did not request this, please ignore this email.\n\nThank you,\nMINEAZY REQFLOW System`.trim()
    });

    res.json({ success: true, message: 'Reset link sent successfully.' });
  } catch (err: any) {
    console.error('[Auth] Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process forgot password request' });
  }
});

// Manual Password Reset Completion
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, email, newPassword } = req.body;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return res.status(503).json({ error: 'System not configured for password resets.' });
  }

  try {
    const supabaseAdmin = createClient(url, serviceRoleKey);
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from('recovery_tokens')
      .select('*')
      .eq('token', token)
      .eq('email', email)
      .gt('expiresAt', new Date().toISOString())
      .maybeSingle();

    if (tokenError || !tokenData) {
      return res.status(400).json({ error: 'Invalid or expired recovery link. Please request a new one.' });
    }

    const { data: userDataList, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    const targetUser = (userDataList?.users as any[])?.find(u => u.email === email);
    
    if (!targetUser) throw new Error('User not found');

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
      password: newPassword
    });

    if (updateError) throw updateError;
    await supabaseAdmin.from('recovery_tokens').delete().eq('id', tokenData.id);

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (err: any) {
    console.error('[Auth] Reset password error:', err);
    res.status(500).json({ error: err.message || 'Failed to update password' });
  }
});

// Notification endpoint
app.post('/api/notify', async (req, res) => {
  const { to, cc, subject, body } = req.body;
  const rawApiKey = process.env.RESEND_API_KEY;
  let apiKey = rawApiKey ? rawApiKey.replace(/\s/g, "").replace(/[^\x00-\x7F]/g, "") : null;

  // Safeguard against stringified "undefined"/"null" or placeholder keys
  if (apiKey === 'undefined' || apiKey === 'null' || apiKey === 're_YOUR_KEY_HERE' || (apiKey && apiKey.length < 10)) {
    apiKey = null;
  }

  console.log('[Notification] Incoming request body:', JSON.stringify({ to, cc, subject, hasBody: !!body }));

  if (!to || !subject || !body) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required notification fields', 
      received: { to: !!to, subject: !!subject, body: !!body } 
    });
  }

  if (apiKey) {
    console.log(`[Notification] API Key present (prefix: ${apiKey.substring(0, 4)}...). Length: ${apiKey.length}`);
  } else {
    console.warn('[Notification] RESEND_API_KEY IS MISSING IN ENVIRONMENT.');
  }

  if (!apiKey) {
    console.log('[Notification] Defaulting to simulation mode...');
    return res.json({ 
      success: true, 
      simulated: true,
      message: 'Notification simulated because RESEND_API_KEY is missing in server environment variables.',
      deliveredTo: to
    });
  }

  try {
    const resend = new Resend(apiKey);
    
    // Vercel sometimes has sandbox issues if using the default onboarding@resend.dev email 
    // to notify people OTHER than the account owner.
    const defaultFrom = 'onboarding@resend.dev';
    const configuredFrom = process.env.VERIFIED_FROM_EMAIL;
    const sanitizeHeader = (str: any) => (typeof str === 'string') ? str.trim().replace(/[^\x00-\x7F]/g, "") : "";
    
    let fromEmail = sanitizeHeader(configuredFrom || defaultFrom);
    
    console.log(`[Notification] Sending to: ${sanitizeHeader(to)} from: ${fromEmail}`);
    
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [sanitizeHeader(to)],
      cc: cc ? [sanitizeHeader(cc)] : undefined,
      subject: sanitizeHeader(subject),
      text: body,
    });

    if (error) {
      console.error('[Notification] Resend API Error:', JSON.stringify(error, null, 2));
      const errorResponse = error as any;
      
      // Handle sandbox/verification restrictions gracefully but clearly
      if (errorResponse?.statusCode === 403 || errorResponse?.name === 'validation_error' || errorResponse?.message?.includes('unauthorized')) {
        console.warn('[Notification] Email delivery restricted by Resend. Falling back to simulation.');
        return res.json({ 
          success: true, 
          simulated: true,
          warning: 'Resend restricted delivery (likely sandbox limitations)',
          message: errorResponse?.message || 'Email delivery was restricted by Resend. Using simulation.',
          errorReason: errorResponse?.message,
          hint: 'If you are using a new Resend account, you can only send to your own email until you verify a domain or add a verified sender.'
        });
      }
      return res.status(500).json({ success: false, error: errorResponse?.message || 'Email delivery failed' });
    }

    console.log(`[Notification] Email sent successfully. ID: ${data?.id}`);
    res.json({ success: true, id: data?.id });
  } catch (err: any) {
    console.error('[Notification] Internal error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error while sending email',
      details: err.message || String(err),
      hint: 'Please check your RESEND_API_KEY and VERIFIED_FROM_EMAIL in Vercel environment variables.'
    });
  }
});

async function configureServer() {
  const PORT = 3000;
  
  // Ensure recovery_tokens table exists
  const initDb = async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) return;

    try {
      const supabaseAdmin = createClient(url, serviceRoleKey);
      const { error } = await supabaseAdmin.from('recovery_tokens').select('id').limit(1);
      if (error && (error.code === 'PGRST116' || error.message.includes('relation "public.recovery_tokens" does not exist'))) {
        console.warn('[DB] recovery_tokens table missing.');
      }
    } catch (err) {
      console.warn('[DB] Failed to check for recovery_tokens table');
    }
  };
  initDb();

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.error('Failed to initialize Vite middleware:', err);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

// Global initialization
configureServer().catch(err => {
  console.error("Failed to start server:", err);
});

export default app;
