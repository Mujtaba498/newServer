const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Middleware to check if user is admin
const adminOnly = async (req, res, next) => {
  try {
    // Check if user is authenticated (should be called after protect middleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Please login first.'
      });
    }

    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authorization'
    });
  }
};

module.exports = {
  adminOnly
};