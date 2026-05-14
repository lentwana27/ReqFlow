import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

async function configureServer() {
  const PORT = 3000;

  app.use(express.json());
  
  // Ensure recovery_tokens table exists
  const initDb = async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) return;

    try {
      const supabaseAdmin = createClient(url, serviceRoleKey);
      // Simple check/creation using RPC or just catch error in endpoints (RPC is safer but requires setup)
      // Since we can't easily run arbitrary SQL via the client without an RPC function, 
      // we'll just log and rely on the user running the SQL for now, 
      // but we'll add a check to warn in logs.
      const { error } = await supabaseAdmin.from('recovery_tokens').select('id').limit(1);
      if (error && error.code === 'PGRST116' || (error && error.message.includes('relation "public.recovery_tokens" does not exist'))) {
        console.warn('[DB] recovery_tokens table missing. Password resets via email may fail until created via supabase_schema.sql');
      }
    } catch (err) {
      console.warn('[DB] Failed to check for recovery_tokens table');
    }
  };
  initDb();

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'REQFLOW PRO' });
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
      // Use service role key to bypass RLS and perform admin actions
      const supabaseAdmin = createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: newPassword
      });

      if (error) throw error;

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
      return res.status(503).json({ error: 'System not configured for password resets.' });
    }

    try {
      const supabaseAdmin = createClient(url, serviceRoleKey);
      
      // 1. Verify user exists
      const { data: user, error: userError } = await supabaseAdmin.auth.admin.listUsers();
      const targetUser = user?.users.find(u => u.email === email);
      
      if (!targetUser) {
        // Silent success for security
        return res.json({ success: true, message: 'If an account exists for this email, a reset link has been sent.' });
      }

      // 2. Generate token
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry

      // 3. Save token
      const { error: tokenError } = await supabaseAdmin
        .from('recovery_tokens')
        .insert([{ email, token, expiresAt: expiresAt.toISOString() }]);

      if (tokenError) throw tokenError;

      // 4. Send email
      const resend = new Resend(resendApiKey.replace(/\s/g, ""));
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const recoveryLink = `${origin}/?recoveryToken=${token}&email=${encodeURIComponent(email)}`;
      
      const fromEmail = process.env.VERIFIED_FROM_EMAIL || 'ReqFlow Pro <onboarding@resend.dev>';
      
      await resend.emails.send({
        from: fromEmail,
        to: [email],
        subject: 'Reset Your ReqFlow Pro Password',
        text: `
Hello,

You recently requested to reset your password for ReqFlow Pro.

To reset your password, please follow the link below (valid for 1 hour):
${recoveryLink}

If you did not request this, please ignore this email.

Thank you,
REQFLOW PRO System
        `.trim()
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

      // 1. Verify token
      const { data: tokenData, error: tokenError } = await supabaseAdmin
        .from('recovery_tokens')
        .select('*')
        .eq('token', token)
        .eq('email', email)
        .gt('expiresAt', new Date().toISOString())
        .single();

      if (tokenError || !tokenData) {
        return res.status(400).json({ error: 'Invalid or expired recovery link. Please request a new one.' });
      }

      // 2. Resolve user ID
      const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      const targetUser = users?.users.find(u => u.email === email);
      
      if (!targetUser) throw new Error('User not found');

      // 3. Update password
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
        password: newPassword
      });

      if (updateError) throw updateError;

      // 4. Delete token
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
    // Strip all whitespace and non-printable characters
    const apiKey = rawApiKey ? rawApiKey.replace(/\s/g, "").replace(/[^\x00-\x7F]/g, "") : null;

    if (apiKey) {
      const keyPrefix = apiKey.substring(0, 3);
      const keyLength = apiKey.length;
      console.log(`[Resend] API Key detected (prefix: ${keyPrefix}..., length: ${keyLength})`);
    }

    console.log('--- Email Notification Request ---');
    console.log(`TO:      ${to}`);
    console.log(`CC:      ${cc || 'None'}`);
    console.log(`SUBJECT: ${subject}`);
    console.log('---------------------------------');

    // Sanitize inputs for HTTP headers (avoid non-ASCII ByteString errors)
    const sanitizeHeader = (str: string) => str ? str.trim().replace(/[^\x00-\x7F]/g, "") : "";
    const safeTo = sanitizeHeader(to);
    const safeCc = cc ? sanitizeHeader(cc) : undefined;
    const safeSubject = sanitizeHeader(subject);

    if (!apiKey) {
      console.warn('[Resend] API KEY missing. Falling back to simulation.');
      return res.json({ 
        success: true, 
        simulated: true,
        message: 'Notification simulated (API KEY missing)',
        deliveredTo: safeTo,
        timestamp: new Date().toISOString()
      });
    }

    try {
      const resend = new Resend(apiKey);
      
      const defaultFrom = 'ReqFlow Pro <onboarding@resend.dev>';
      const configuredFrom = process.env.VERIFIED_FROM_EMAIL;
      let fromEmail = sanitizeHeader(configuredFrom || defaultFrom);
      
      console.log(`[Resend] Sending from: ${fromEmail}`);
      console.log(`[Resend] Recipient: ${safeTo}`);

      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [safeTo],
        cc: safeCc ? [safeCc] : undefined,
        subject: safeSubject,
        text: body,
      });

      if (error) {
        const errorResponse = error as any;
        const errorName = errorResponse?.name || errorResponse?.type;
        const errorMessage = errorResponse?.message || 'Unknown Resend error';
        
        // If it's a verification/forbidden error (Sandbox limit or domain issue)
        if (errorResponse?.statusCode === 403 || errorName === 'validation_error') {
          // If the error is specifically about the API key, we should NOT simulate success
          if (errorMessage.toLowerCase().includes('api key is invalid')) {
            console.error(`[Resend Error] Invalid API Key: ${errorMessage}`);
            return res.status(401).json({ 
              success: false, 
              error: 'Invalid API Key',
              message: 'The Resend API Key provided in Settings is invalid or has been revoked.',
              hint: 'Double-check your API Key in the application Settings.'
            });
          }

          console.warn(`[Resend Sandbox Notice] Recipient: ${safeTo}. Reason: ${errorMessage}`);
          
          return res.json({ 
            success: true, 
            simulated: true,
            warning: 'Resend Delivery Restriction',
            message: 'Email delivery was restricted. Falling back to simulation.',
            errorReason: errorMessage,
            deliveredTo: safeTo,
            timestamp: new Date().toISOString(),
            hint: fromEmail === defaultFrom 
              ? 'Using Resend sandbox domain. Configure VERIFIED_FROM_EMAIL in Settings with your verified domain email.'
              : 'Your domain may not be fully verified, or the "from" address is not authorized in Resend.'
          });
        }
        
        console.error('Resend API Error:', JSON.stringify(error, null, 2));
        return res.status(500).json({ success: false, error: errorMessage });
      }

      console.log(`[Resend] Success! ID: ${data?.id}`);
      res.json({ 
        success: true, 
        message: 'Email sent successfully via Resend',
        id: data?.id,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Resend] Catch-all error:', err);
      res.status(500).json({ success: false, error: 'Internal server error while sending email' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
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
