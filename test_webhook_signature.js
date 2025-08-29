const crypto = require('crypto');

// This script generates the correct signature for testing Cryptomus webhooks
// It mimics how Cryptomus creates signatures for webhook verification

const webhookData = {
  uuid: 'test-uuid-12345',
  order_id: '123232323223222',
  payment_status: 'paid',
  amount: '3.00'
};

// Your webhook secret from .env file
const webhookSecret = 'halwapuri';

// Step 1: Convert webhook data to JSON string
const jsonString = JSON.stringify(webhookData);
console.log('Step 1 - JSON String:', jsonString);

// Step 2: Encode the JSON string to base64
const encodedData = Buffer.from(jsonString).toString('base64');
console.log('Step 2 - Base64 Encoded:', encodedData);

// Step 3: Combine encoded data with webhook secret
const dataToHash = encodedData + webhookSecret;
console.log('Step 3 - Data to hash:', dataToHash);

// Step 4: Generate MD5 hash (this is the signature)
const signature = crypto.createHash('md5').update(dataToHash).digest('hex');
console.log('Step 4 - Final Signature:', signature);

console.log('\n=== CURL COMMAND FOR TESTING ===');
console.log(`curl -X POST "http://localhost:5000/api/payments/webhook" \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -H "sign: ${signature}" \\`);
console.log(`  -d '${jsonString}'`);

console.log('\n=== EXPLANATION ===');
console.log('This signature verification ensures that:');
console.log('1. The webhook request actually comes from Cryptomus');
console.log('2. The data hasn\'t been tampered with during transmission');
console.log('3. Only authorized parties can trigger webhook events');
console.log('\nCryptomus generates this signature using the same process and sends it in the "sign" header.');