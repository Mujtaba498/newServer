const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

// Test script to verify admin bot analysis endpoint
async function testAdminBotAnalysis() {
  try {
    console.log('Testing Admin Bot Analysis Endpoint...');
    
    // You'll need to replace these with actual values:
    const BASE_URL = 'http://localhost:4002'; // or your server URL
    const ADMIN_JWT_TOKEN = 'YOUR_ADMIN_JWT_TOKEN_HERE'; // Replace with actual admin token
    const BOT_ID = '68bc2a3b13bd575ddf86d774'; // The bot ID from your example
    
    console.log(`Testing endpoint: ${BASE_URL}/api/admin/grid-bots/${BOT_ID}/analysis`);
    
    const response = await axios.get(
      `${BASE_URL}/api/admin/grid-bots/${BOT_ID}/analysis`,
      {
        headers: {
          'Authorization': `Bearer ${ADMIN_JWT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Success! Admin can access bot analysis');
    console.log('Response status:', response.status);
    console.log('Response message:', response.data.message);
    
    if (response.data.data && response.data.data.botOwner) {
      console.log('Bot Owner Info:', response.data.data.botOwner);
    }
    
    console.log('Analysis data available:', !!response.data.data.analysis);
    
  } catch (error) {
    if (error.response) {
      console.log('❌ Error Response:');
      console.log('Status:', error.response.status);
      console.log('Message:', error.response.data.message);
      
      if (error.response.status === 401) {
        console.log('\n🔑 Authentication required. Please:');
        console.log('1. Login as admin to get JWT token');
        console.log('2. Replace ADMIN_JWT_TOKEN in this script');
      } else if (error.response.status === 403) {
        console.log('\n🚫 Admin privileges required. Please:');
        console.log('1. Ensure your user has role: "admin"');
        console.log('2. Use a valid admin JWT token');
      } else if (error.response.status === 404) {
        console.log('\n🔍 Bot not found. Please:');
        console.log('1. Check if the bot ID exists');
        console.log('2. Ensure the bot is not deleted');
      }
    } else {
      console.log('❌ Network/Server Error:', error.message);
    }
  }
}

// Instructions for manual testing
console.log('='.repeat(60));
console.log('ADMIN BOT ANALYSIS ENDPOINT TEST');
console.log('='.repeat(60));
console.log('\nBefore running this test:');
console.log('1. Start your server (npm start)');
console.log('2. Get an admin JWT token by logging in as admin');
console.log('3. Replace ADMIN_JWT_TOKEN in this script');
console.log('4. Replace BOT_ID with an actual bot ID');
console.log('\nEndpoint created: GET /api/admin/grid-bots/:botId/analysis');
console.log('\nThis endpoint allows admins to:');
console.log('- Access any user\'s bot analysis without ownership checks');
console.log('- View detailed bot performance and statistics');
console.log('- See bot owner information for context');
console.log('\n' + '='.repeat(60));

// Uncomment the line below to run the test
// testAdminBotAnalysis();

console.log('\n✅ Admin bot analysis endpoint has been implemented!');
console.log('\nTo test manually with curl:');
console.log('curl -X GET "http://localhost:4002/api/admin/grid-bots/BOT_ID_HERE/analysis" \\');
console.log('  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \\');
console.log('  -H "Content-Type: application/json"');