







export default function handler(req, res) {
  const hasKey = !!process.env.FAST2SMS_KEY;
  const keyLength = process.env.FAST2SMS_KEY ? process.env.FAST2SMS_KEY.length : 0;
  res.status(200).json({ hasKey, keyLength });
}
 
 