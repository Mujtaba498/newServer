const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Test with the actual Cryptomus webhook format based on their documentation
async function testRealWebhookFormat() {
  try {
    // Sample webhook data in the format Cryptomus actually sends
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
      "status": "paid", // Note: using 'status' instead of 'payment_status'
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

    // Generate signature using webhook secret (on data WITHOUT sign field)
    const webhookSecret = process.env.CRYPTOMUS_WEBHOOK_SECRET;
    const jsonString = JSON.stringify(webhookData);
    const encodedData = Buffer.from(jsonString).toString('base64');
    const signature = crypto.createHash('md5').update(encodedData + webhookSecret).digest('hex');
    
    // Add signature to webhook data (as Cryptomus does)
    const webhookWithSignature = {
      ...webhookData,
      sign: signature
    };
    
    console.log('Data used for signature calculation:', jsonString);
    console.log('Base64 encoded:', encodedData);
    console.log('Webhook secret:', webhookSecret);

    console.log('Testing webhook with real Cryptomus format...');
    console.log('Webhook data:', JSON.stringify(webhookWithSignature, null, 2));
    console.log('Generated signature:', signature);

    // Send webhook to local server
    const response = await axios.post('http://localhost:5000/api/payments/webhook', webhookWithSignature, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GuzzleHttp/7'
      },
      timeout: 10000
    });

    console.log('\n=== WEBHOOK RESPONSE ===');
    console.log('Status:', response.status);
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('\n=== WEBHOOK TEST ERROR ===');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Run the test
testRealWebhookFormat();