const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Test webhook endpoint manually
async function testWebhook() {
  try {
    // First, let's test if the endpoint is accessible
    console.log('Testing webhook endpoint accessibility...');
    
    const baseUrl = 'http://localhost:5000';
    const webhookUrl = `${baseUrl}/api/payments/webhook`;
    
    // Test with a sample webhook payload (similar to what Cryptomus would send)
    const webhookData = {
      order_id: 'sub_689f1db50937f20414fb808c_1755960443007', // Use the latest pending payment
      payment_status: 'paid',
      amount: '1.00',
      payment_amount: '1.00',
      payer_currency: 'USD',
      uuid: 'test-uuid-12345',
      txid: 'test-transaction-hash',
      network: 'TRX',
      fail_reason: null
    };
    
    console.log('Webhook payload:', JSON.stringify(webhookData, null, 2));
    
    // Generate signature (same way Cryptomus does)
    const jsonString = JSON.stringify(webhookData);
    const encodedData = Buffer.from(jsonString).toString('base64');
    const signature = crypto
      .createHash('md5')
      .update(encodedData + process.env.CRYPTOMUS_WEBHOOK_SECRET)
      .digest('hex');
    
    console.log('\nSignature calculation:');
    console.log('JSON String:', jsonString);
    console.log('Base64 Encoded:', encodedData);
    console.log('Webhook Secret:', process.env.CRYPTOMUS_WEBHOOK_SECRET);
    console.log('Generated Signature:', signature);
    
    // Send webhook request
    console.log('\nSending webhook request...');
    const response = await axios.post(webhookUrl, webhookData, {
      headers: {
        'Content-Type': 'application/json',
        'sign': signature,
        'User-Agent': 'Cryptomus-Webhook/1.0'
      },
      timeout: 10000
    });
    
    console.log('\n✅ Webhook Response:');
    console.log('Status:', response.status);
    console.log('Data:', response.data);
    
  } catch (error) {
    console.error('\n❌ Webhook Test Failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    } else if (error.request) {
      console.error('No response received:', error.message);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Test endpoint accessibility first
async function testEndpointAccessibility() {
  try {
    console.log('Testing basic endpoint accessibility...');
    const response = await axios.get('http://localhost:5000/health');
    console.log('✅ Server is running:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Server is not accessible:', error.message);
    return false;
  }
}

async function main() {
  console.log('=== WEBHOOK TESTING SCRIPT ===\n');
  
  const isServerRunning = await testEndpointAccessibility();
  if (!isServerRunning) {
    console.log('\nPlease start the server first with: npm start');
    return;
  }
  
  console.log('\n' + '='.repeat(50));
  await testWebhook();
}

main();