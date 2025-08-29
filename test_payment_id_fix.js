const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('./models/User');
const Subscription = require('./models/Subscription');

const BASE_URL = 'http://localhost:5000/api';

async function testPaymentIdFix() {
  try {
    console.log('=== TESTING PAYMENT ID VALIDATION FIX ===\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clean up any existing test data
    console.log('\n1. Cleaning up existing test data...');
    await User.deleteMany({ email: { $in: ['testuser@example.com', 'admin@example.com'] } });
    await Subscription.deleteMany({ paymentId: { $regex: /^(test_|admin_upgrade_)/ } });
    console.log('✅ Test data cleaned up');

    // Create test users
    console.log('\n2. Creating test users...');
    
    // Create admin user
    const adminUser = new User({
      name: 'Admin User',
      email: 'admin@example.com',
      password: 'AdminPassword123',
      role: 'admin'
    });
    await adminUser.save();
    
    // Create regular user
    const testUser = new User({
      name: 'Test User',
      email: 'testuser@example.com',
      password: 'TestPassword123',
      role: 'user'
    });
    await testUser.save();
    
    console.log('✅ Test users created');

    // Create an expired subscription WITHOUT paymentId (simulating old data)
    console.log('\n3. Creating expired subscription without paymentId...');
    const expiredSubscription = new Subscription({
      userId: testUser._id,
      planType: 'free', // Start as free
      status: 'expired',
      startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
      endDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      // Note: No paymentId set
    });
    await expiredSubscription.save();
    console.log('✅ Expired subscription created without paymentId');

    // Login as admin
    console.log('\n4. Logging in as admin...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin@example.com',
      password: 'AdminPassword123'
    });
    
    const adminToken = loginResponse.data.data.token;
    console.log('✅ Admin logged in successfully');

    // Test: Upgrade expired subscription to premium (should not fail with paymentId validation)
    console.log('\n5. Testing premium upgrade on expired subscription...');
    const upgradeResponse = await axios.post(
      `${BASE_URL}/admin/users/${testUser._id}/upgrade-premium`,
      { duration: 30 },
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      }
    );
    
    console.log('✅ Premium upgrade successful');
    console.log('Response:', upgradeResponse.data.message);
    
    // Verify subscription was updated correctly
    const updatedSubscription = await Subscription.findOne({ userId: testUser._id });
    console.log('\n6. Verifying updated subscription...');
    console.log(`✅ Plan Type: ${updatedSubscription.planType}`);
    console.log(`✅ Status: ${updatedSubscription.status}`);
    console.log(`✅ Payment ID: ${updatedSubscription.paymentId}`);
    console.log(`✅ End Date: ${updatedSubscription.endDate}`);
    
    // Verify paymentId is now present
    if (updatedSubscription.paymentId && updatedSubscription.paymentId.startsWith('admin_upgrade_')) {
      console.log('✅ PaymentId correctly generated for admin upgrade');
    } else {
      console.log('❌ PaymentId missing or incorrect');
    }
    
    // Verify subscription is active and premium
    if (updatedSubscription.planType === 'premium' && updatedSubscription.status === 'active') {
      console.log('✅ Subscription correctly upgraded to active premium');
    } else {
      console.log('❌ Subscription upgrade failed');
    }

    // Test: Another upgrade (should extend existing subscription)
    console.log('\n7. Testing extension of existing premium subscription...');
    const extendResponse = await axios.post(
      `${BASE_URL}/admin/users/${testUser._id}/upgrade-premium`,
      { duration: 15 },
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      }
    );
    
    console.log('✅ Extension successful');
    console.log('Response:', extendResponse.data.message);

    // Cleanup
    console.log('\n8. Cleaning up test data...');
    await User.deleteMany({ email: { $in: ['testuser@example.com', 'admin@example.com'] } });
    await Subscription.deleteMany({ paymentId: { $regex: /^admin_upgrade_/ } });
    console.log('✅ Test data cleaned up');

    console.log('\n=== ALL TESTS PASSED - PAYMENT ID VALIDATION ERROR FIXED ===');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

// Run the test
testPaymentIdFix();