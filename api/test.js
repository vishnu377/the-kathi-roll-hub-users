
export default async function handler(req, res) {
  try {
    const apiKey = process.env.FAST2SMS_KEY;
    const testMobile = '9999999999'; // dummy number, won't actually deliver
 
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&variables_values=1234&route=otp&numbers=${testMobile}`;
 
    const smsRes = await fetch(url, { method: 'GET' });
    const smsData = await smsRes.json();
 
    res.status(200).json({ step: 'fast2sms call succeeded', smsData });
  } catch (err) {
    res.status(200).json({ step: 'fast2sms call FAILED', error: err.message, stack: err.stack });
  }
}
 






