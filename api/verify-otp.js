// ============================================================
//  api/verify-otp.js  —  Vercel Serverless Function
//  Verifies the OTP via 2Factor.in using the stored session ID.
// ============================================================

export default async function handler(req, res) {
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
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({ success: false, message: 'Mobile aur OTP dono chahiye' });
    }

    const apiKey = process.env.TWOFACTOR_API_KEY;
    if (!apiKey) {
      console.error('[verify-otp] TWOFACTOR_API_KEY not set in environment');
      return res.status(500).json({ success: false, message: 'Server config error' });
    }

    // ── Fetch the stored session ID + expiry from Firestore ────
    const projectId = 'the-kathi-roll-hub';
    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/temp_otps/${mobile}`;

    const fsRes = await fetch(docUrl);
    if (!fsRes.ok) {
      return res.status(400).json({ success: false, message: 'OTP nahi mila — pehle bhejo' });
    }

    const fsData = await fsRes.json();
    const sessionId = fsData.fields?.sessionId?.stringValue;
    const expiresAt  = fsData.fields?.expiresAt?.stringValue;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'OTP nahi mila — pehle bhejo' });
    }

    if (expiresAt && new Date(expiresAt) < new Date()) {
      await fetch(docUrl, { method: 'DELETE' }).catch(() => {});
      return res.status(400).json({ success: false, message: '❌ OTP expire ho gaya. Naya bhejo.' });
    }

    // ── Verify with 2Factor using the session ID ───────────────
    const verifyUrl = `https://2factor.in/API/V1/${apiKey}/SMS/VERIFY/${sessionId}/${otp}`;
    const verifyRes = await fetch(verifyUrl, { method: 'GET' });
    const verifyData = await verifyRes.json();

    if (verifyData.Status !== 'Success' || verifyData.Details !== 'OTP Matched') {
      return res.status(400).json({ success: false, message: '❌ Galat OTP' });
    }

    // ── OTP correct — delete the session so it can't be reused ──
    await fetch(docUrl, { method: 'DELETE' }).catch(() => {});

    return res.status(200).json({ success: true, message: '✅ Verified' });

  } catch (err) {
    console.error('[verify-otp] Unexpected error:', err);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}