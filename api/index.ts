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
