const crypto = require('crypto');
require('dotenv').config();

// Test data from the webhook (without sign field)
const webhookData = {
  "type": "payment",
  "uuid": "db9c3d56-ba57-4c80-9d1d-bd36754c56a4",
  "order_id": "sub_68a9a1141ce5c273f1299dc3_1755953517331",
  "amount": "1.00000000",
  "payment_amount": "0.00000000",
  "payment_amount_usd": "0.00",
  "merchant_amount": "1.00045592",
  "commission": "0.02040930",
  "is_final": true,
  "status": "paid",
  "from": null,
  "wallet_address_uuid": null,
  "network": "tron",
  "currency": "USD",
  "payer_currency": "USDT",
  "payer_amount": "1.02000000",
  "payer_amount_exchange_rate": "0.99954428",
  "additional_data": "{\\\"user_email\\\":\\\"zakiakhanuel05@gmail.com\\\",\\\"user_name\\\":\\\"Zakia\\\",\\\"description\\\":\\\"Premium Subscription - 30 Days\\\"}",
  "transfer_id": null
};

const webhookSecret = process.env.CRYPTOMUS_WEBHOOK_SECRET;

console.log('=== SIGNATURE DEBUG ===');
console.log('Webhook Secret:', webhookSecret);
console.log('\nOriginal webhook data:');
console.log(JSON.stringify(webhookData, null, 2));

// Calculate signature
const jsonString = JSON.stringify(webhookData);
const encodedData = Buffer.from(jsonString).toString('base64');
const signature = crypto.createHash('md5').update(encodedData + webhookSecret).digest('hex');

console.log('\nJSON String:', jsonString);
console.log('\nBase64 Encoded:', encodedData);
console.log('\nGenerated Signature:', signature);

// Now test what happens when we parse the received data
const receivedData = {
  ...webhookData,
  sign: signature
};

console.log('\n=== SIMULATING SERVER PROCESSING ===');
console.log('Received data with sign:', JSON.stringify(receivedData, null, 2));

// Remove sign field (as server does)
const dataForVerification = { ...receivedData };
delete dataForVerification.sign;

console.log('\nData after removing sign field:');
console.log(JSON.stringify(dataForVerification, null, 2));

// Calculate expected signature (as server does)
const serverJsonString = JSON.stringify(dataForVerification);
const serverEncodedData = Buffer.from(serverJsonString).toString('base64');
const serverExpectedSignature = crypto.createHash('md5').update(serverEncodedData + webhookSecret).digest('hex');

console.log('\nServer JSON String:', serverJsonString);
console.log('Server Base64 Encoded:', serverEncodedData);
console.log('Server Expected Signature:', serverExpectedSignature);

console.log('\n=== COMPARISON ===');
console.log('Client Generated Signature:', signature);
console.log('Server Expected Signature:', serverExpectedSignature);
console.log('Signatures Match:', signature === serverExpectedSignature);

if (signature !== serverExpectedSignature) {
  console.log('\n=== DIFFERENCE ANALYSIS ===');
  console.log('Client JSON length:', jsonString.length);
  console.log('Server JSON length:', serverJsonString.length);
  console.log('Client Base64 length:', encodedData.length);
  console.log('Server Base64 length:', serverEncodedData.length);
  
  // Check if JSON strings are different
  if (jsonString !== serverJsonString) {
    console.log('\nJSON strings are different!');
    console.log('Client JSON:', jsonString);
    console.log('Server JSON:', serverJsonString);
  }
}