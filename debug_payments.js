const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const Subscription = require('./models/Subscription');
require('dotenv').config();

async function debugPayments() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Get recent payments
    console.log('\n=== RECENT PAYMENTS ===');
    const recentPayments = await Payment.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('cryptomusOrderId userId amount status planType planDuration createdAt paidAt webhookData');
    
    if (recentPayments.length === 0) {
      console.log('No payments found in database');
    } else {
      recentPayments.forEach((payment, index) => {
        console.log(`\n${index + 1}. Payment ID: ${payment._id}`);
        console.log(`   Order ID: ${payment.cryptomusOrderId}`);
        console.log(`   User ID: ${payment.userId}`);
        console.log(`   Amount: ${payment.amount}`);
        console.log(`   Status: ${payment.status}`);
        console.log(`   Plan: ${payment.planType} (${payment.planDuration} days)`);
        console.log(`   Created: ${payment.createdAt}`);
        console.log(`   Paid At: ${payment.paidAt || 'Not paid'}`);
        console.log(`   Has Webhook Data: ${payment.webhookData ? 'YES' : 'NO'}`);
      });
    }
    
    // Get recent subscriptions
    console.log('\n\n=== RECENT SUBSCRIPTIONS ===');
    const recentSubscriptions = await Subscription.find({})
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('userId planType status startDate endDate paymentId createdAt updatedAt');
    
    if (recentSubscriptions.length === 0) {
      console.log('No subscriptions found in database');
    } else {
      recentSubscriptions.forEach((sub, index) => {
        console.log(`\n${index + 1}. Subscription ID: ${sub._id}`);
        console.log(`   User ID: ${sub.userId}`);
        console.log(`   Plan: ${sub.planType}`);
        console.log(`   Status: ${sub.status}`);
        console.log(`   Start Date: ${sub.startDate}`);
        console.log(`   End Date: ${sub.endDate}`);
        console.log(`   Payment ID: ${sub.paymentId || 'None'}`);
        console.log(`   Created: ${sub.createdAt}`);
        console.log(`   Updated: ${sub.updatedAt}`);
      });
    }
    
    // Check for specific user subscription
    const userId = '689f1db50937f20414fb808c';
    console.log(`\n\n=== USER ${userId} DETAILS ===`);
    
    const userPayments = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5);
    
    console.log(`\nUser Payments (${userPayments.length}):`);
    userPayments.forEach((payment, index) => {
      console.log(`${index + 1}. ${payment.cryptomusOrderId} - ${payment.status} - ${payment.amount} - ${payment.createdAt}`);
    });
    
    const userSubscription = await Subscription.findOne({ userId });
    console.log(`\nUser Subscription:`);
    if (userSubscription) {
      console.log(`   Plan: ${userSubscription.planType}`);
      console.log(`   Status: ${userSubscription.status}`);
      console.log(`   End Date: ${userSubscription.endDate}`);
      console.log(`   Payment ID: ${userSubscription.paymentId}`);
      console.log(`   Last Updated: ${userSubscription.updatedAt}`);
    } else {
      console.log('   No subscription found for this user');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

debugPayments();