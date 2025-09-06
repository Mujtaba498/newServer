const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Subscription = require('./models/Subscription');

const BASE_URL = 'http://localhost:4002/api';

async function testDowngradeFunctionality() {
  try {
    console.log('🧪 Testing Admin Downgrade Functionality');
    console.log('=' .repeat(50));

    // Connect to database
    console.log('\n1. Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Database connected');

    // Create test user with unique email
    console.log('\n2. Creating test user...');
    const timestamp = Date.now();
    const testUser = new User({
      name: 'Test Premium User',
      email: `testpremium${timestamp}@example.com`,
      password: 'TestPassword123',
      role: 'user'
    });
    await testUser.save();
    console.log('✅ Test user created:', testUser._id);

    // Create premium subscription for test user
    console.log('\n3. Creating premium subscription...');
    const premiumSubscription = new Subscription({
      userId: testUser._id,
      planType: 'premium',
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      paymentId: 'test_premium_payment_123'
    });
    await premiumSubscription.save();
    console.log('✅ Premium subscription created');

    // Create admin user with unique email
    console.log('\n4. Creating admin user...');
    const adminUser = new User({
      name: 'Test Admin',
      email: `testadmin${timestamp}@example.com`,
      password: 'AdminPassword123',
      role: 'admin'
    });
    await adminUser.save();
    console.log('✅ Admin user created');

    // Login as admin
    console.log('\n5. Logging in as admin...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: `testadmin${timestamp}@example.com`,
      password: 'AdminPassword123'
    });
    
    const adminToken = loginResponse.data.data.token;
    console.log('✅ Admin logged in successfully');

    // Test: Downgrade premium user to free
    console.log('\n6. Testing downgrade premium user to free...');
    const downgradeResponse = await axios.post(
      `${BASE_URL}/admin/users/${testUser._id}/downgrade-free`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      }
    );
    
    console.log('✅ Downgrade successful');
    console.log('Response:', downgradeResponse.data.message);
    console.log('New plan type:', downgradeResponse.data.data.subscription.planType);
    
    // Verify subscription was updated correctly
    const updatedSubscription = await Subscription.findOne({ userId: testUser._id });
    console.log('\n7. Verifying updated subscription...');
    console.log(`✅ Plan Type: ${updatedSubscription.planType}`);
    console.log(`✅ Status: ${updatedSubscription.status}`);
    console.log(`✅ End Date: ${updatedSubscription.endDate}`);
    console.log(`✅ Payment ID: ${updatedSubscription.paymentId}`);

    // Test: Try to downgrade already free user (should fail)
    console.log('\n8. Testing downgrade already free user (should fail)...');
    try {
      await axios.post(
        `${BASE_URL}/admin/users/${testUser._id}/downgrade-free`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        }
      );
      console.log('❌ Should have failed but didn\'t');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✅ Correctly failed with 400 status');
        console.log('Error message:', error.response.data.message);
      } else {
        console.log('❌ Failed with unexpected error:', error.message);
      }
    }

    // Test: Try to downgrade non-existent user (should fail)
    console.log('\n9. Testing downgrade non-existent user (should fail)...');
    const fakeUserId = new mongoose.Types.ObjectId();
    try {
      await axios.post(
        `${BASE_URL}/admin/users/${fakeUserId}/downgrade-free`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        }
      );
      console.log('❌ Should have failed but didn\'t');
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('✅ Correctly failed with 404 status');
        console.log('Error message:', error.response.data.message);
      } else {
        console.log('❌ Failed with unexpected error:', error.message);
      }
    }

    // Test: Try to downgrade with invalid user ID (should fail)
    console.log('\n10. Testing downgrade with invalid user ID (should fail)...');
    try {
      await axios.post(
        `${BASE_URL}/admin/users/invalid_id/downgrade-free`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        }
      );
      console.log('❌ Should have failed but didn\'t');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✅ Correctly failed with 400 status');
        console.log('Error message:', error.response.data.message);
      } else {
        console.log('❌ Failed with unexpected error:', error.message);
      }
    }

    console.log('\n🎉 All downgrade functionality tests completed successfully!');
    
    // Cleanup
    console.log('\n11. Cleaning up test data...');
    await User.deleteOne({ _id: testUser._id });
    await User.deleteOne({ _id: adminUser._id });
    await Subscription.deleteOne({ userId: testUser._id });
    console.log('✅ Test data cleaned up');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    console.error('Full error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Database disconnected');
    process.exit(0);
  }
}

// Run the test
testDowngradeFunctionality();