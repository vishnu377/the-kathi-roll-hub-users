
// ============================================================
//  api/send-otp.js  —  Vercel Serverless Function
//  Sends an OTP via 2Factor.in using Vi DLT approved template.
//  The API key NEVER reaches the browser — it lives only in
//  Vercel's server environment.
// ============================================================

export default async function handler(req, res) {
  // CORS — allow calls from your own frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { mobile } = req.body;

    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: '10-digit mobile number chahiye' });
    }

    const apiKey = process.env.TWOFACTOR_API_KEY;
    if (!apiKey) {
      console.error('[send-otp] TWOFACTOR_API_KEY not set in environment');
      return res.status(500).json({ success: false, message: 'Server config error' });
    }

    // ── Vi DLT Approved Template: VishtechOTP ──────────────
    // Sender: VISHTS (Vi approved header)
    // Template: "Your OTP for login is {#numeric#}. 
    //            Valid for 5 minutes. Do not share with anyone."
    // AUTOGEN = 2Factor generates OTP automatically
    const url = `https://2factor.in/API/V1/${apiKey}/SMS/${mobile}/AUTOGEN3/VishtechOTP`;

    const smsRes = await fetch(url, { method: 'GET' });
    const smsData = await smsRes.json();

    if (smsData.Status !== 'Success') {
      console.error('[send-otp] 2Factor error:', smsData);
      return res.status(502).json({ success: false, message: smsData.Details || 'SMS bhejne mein dikkat hui' });
    }

    const sessionId = smsData.Details; // 2Factor's session id for this OTP

    // ── Store session ID in Firestore (REST API) ────────────
    const projectId = 'the-kathi-roll-hub';
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/temp_otps/${mobile}`;

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min expiry

    const fsRes = await fetch(firestoreUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          sessionId: { stringValue: sessionId },
          expiresAt: { stringValue: expiresAt },
          createdAt: { stringValue: new Date().toISOString() }
        }
      })
    });

    if (!fsRes.ok) {
      const fsErr = await fsRes.text();
      console.error('[send-otp] Firestore write failed:', fsErr);
      return res.status(500).json({ success: false, message: 'OTP save nahi hua' });
    }

    return res.status(200).json({ success: true, message: 'OTP bhej diya gaya' });

  } catch (err) {
    console.error('[send-otp] Unexpected error:', err);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}







