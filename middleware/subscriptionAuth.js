const Subscription = require('../models/Subscription');
const GridBot = require('../models/GridBot');

// Middleware to check subscription status and attach to request
const checkSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Skip subscription checks for admin users
    if (req.user.role === 'admin') {
      // Create unlimited plan for admin
      req.subscription = {
        userId,
        planType: 'admin',
        status: 'active',
        isActive: () => true,
        isExpired: () => false,
        getPlanLimits: () => ({
          maxBots: Infinity,
          maxInvestmentPerBot: Infinity,
          features: ['unlimited_bots', 'unlimited_investment', 'admin_access']
        })
      };
      req.planLimits = req.subscription.getPlanLimits();
      return next();
    }
    
    // Find user's subscription or create default free subscription
    let subscription = await Subscription.findOne({ userId });
    
    if (!subscription) {
      // Create default free subscription for new users
      subscription = new Subscription({
        userId,
        planType: 'free',
        status: 'active'
      });
      await subscription.save();
    }
    
    // Check if premium subscription is expired
    if (subscription.planType === 'premium' && subscription.isExpired()) {
      subscription.status = 'expired';
      subscription.planType = 'free'; // Downgrade to free
      await subscription.save();
    }
    
    // Attach subscription info to request
    req.subscription = subscription;
    req.planLimits = subscription.getPlanLimits();
    
    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify subscription status'
    });
  }
};

// Middleware to enforce bot creation limits
const enforceBotLimits = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { investment } = req.body;
    const planLimits = req.planLimits;
    
    // Skip limits for admin users
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Check investment limit
    if (investment > planLimits.maxInvestmentPerBot) {
      return res.status(403).json({
        success: false,
        message: `Investment amount exceeds your plan limit of $${planLimits.maxInvestmentPerBot}. ${req.subscription.planType === 'free' ? 'Upgrade to Premium for higher limits.' : ''}`,
        error: 'INVESTMENT_LIMIT_EXCEEDED',
        currentPlan: req.subscription.planType,
        limits: planLimits
      });
    }
    
    // Check bot count limit
    const userBotCount = await GridBot.countDocuments({ userId });
    
    if (userBotCount >= planLimits.maxBots) {
      return res.status(403).json({
        success: false,
        message: `You have reached the maximum number of bots (${planLimits.maxBots}) for your ${req.subscription.planType} plan. ${req.subscription.planType === 'free' ? 'Upgrade to Premium to create more bots.' : 'Delete some bots to create new ones.'}`,
        error: 'BOT_LIMIT_EXCEEDED',
        currentPlan: req.subscription.planType,
        currentBotCount: userBotCount,
        limits: planLimits
      });
    }
    
    next();
  } catch (error) {
    console.error('Bot limits enforcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify bot limits'
    });
  }
};

// Middleware to check if user has premium subscription
const requirePremium = (req, res, next) => {
  // Allow admin users to access premium features
  if (req.user.role === 'admin') {
    return next();
  }
  
  if (req.subscription.planType !== 'premium' || !req.subscription.isActive()) {
    return res.status(403).json({
      success: false,
      message: 'This feature requires a Premium subscription',
      error: 'PREMIUM_REQUIRED',
      currentPlan: req.subscription.planType
    });
  }
  next();
};

// Middleware to get subscription info for responses
const attachSubscriptionInfo = (req, res, next) => {
  // Add subscription info to response locals for easy access
  res.locals.subscriptionInfo = {
    planType: req.subscription.planType,
    status: req.subscription.status,
    isActive: req.subscription.isActive(),
    limits: req.planLimits,
    endDate: req.subscription.endDate || null,
    isAdmin: req.user.role === 'admin'
  };
  next();
};

// Helper function to get user's current bot usage
const getUserBotUsage = async (userId) => {
  try {
    const totalBots = await GridBot.countDocuments({ userId });
    const activeBots = await GridBot.countDocuments({ 
      userId, 
      status: { $in: ['running', 'paused'] } 
    });
    
    const totalInvestment = await GridBot.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: '$investment' } } }
    ]);
    
    return {
      totalBots,
      activeBots,
      totalInvestment: totalInvestment[0]?.total || 0
    };
  } catch (error) {
    console.error('Error getting user bot usage:', error);
    return {
      totalBots: 0,
      activeBots: 0,
      totalInvestment: 0
    };
  }
};

// Middleware to validate subscription for specific actions
const validateSubscriptionAction = (action) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const planLimits = req.planLimits;
      
      // Skip validation for admin users
      if (req.user.role === 'admin') {
        return next();
      }
      
      switch (action) {
        case 'create_bot':
          // Already handled by enforceBotLimits
          break;
          
        case 'start_bot':
          // Check if user can start more bots
          const activeBots = await GridBot.countDocuments({ 
            userId, 
            status: { $in: ['running'] } 
          });
          
          if (activeBots >= planLimits.maxBots) {
            return res.status(403).json({
              success: false,
              message: `You cannot run more than ${planLimits.maxBots} bots simultaneously on your ${req.subscription.planType} plan`,
              error: 'ACTIVE_BOT_LIMIT_EXCEEDED',
              currentPlan: req.subscription.planType,
              limits: planLimits
            });
          }
          break;
          
        default:
          // No specific validation needed
          break;
      }
      
      next();
    } catch (error) {
      console.error('Subscription action validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to validate subscription action'
      });
    }
  };
};

module.exports = {
  checkSubscription,
  enforceBotLimits,
  requirePremium,
  attachSubscriptionInfo,
  getUserBotUsage,
  validateSubscriptionAction
};