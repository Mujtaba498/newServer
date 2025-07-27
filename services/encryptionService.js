import crypto from 'crypto';

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = this.initializeSecretKey();
    
  }

  initializeSecretKey() {
    if (process.env.ENCRYPTION_KEY) {
      // If provided, ensure it's exactly 32 bytes
      const key = process.env.ENCRYPTION_KEY;
      if (key.length === 32) {
        return Buffer.from(key, 'utf8');
      } else {
        // Hash the provided key to get exactly 32 bytes
        return crypto.createHash('sha256').update(key).digest();
      }
    } else {
      // Generate a default key for development
      return crypto.scryptSync('crypto-backend-default-key', 'salt', 32);
    }
  }

  encrypt(text) {
    try {
      if (!text) return null;
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
      cipher.setAAD(Buffer.from('binance-api-key', 'utf8'));
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex')
      };
    } catch (error) {
      throw new Error('Failed to encrypt data');
    }
  }

  decrypt(encryptedData) {
    try {
      if (!encryptedData) return null;
      
      // Handle both string and object formats for backward compatibility
      let encrypted, iv, tag;
      
      if (typeof encryptedData === 'string') {
        // Simple string format (fallback) - use simple decrypt
        return this.decryptSimple(encryptedData);
      } else {
        // Object format with IV and tag
        encrypted = encryptedData.encrypted;
        iv = Buffer.from(encryptedData.iv, 'hex');
        tag = Buffer.from(encryptedData.tag, 'hex');
      }
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
      decipher.setAAD(Buffer.from('binance-api-key', 'utf8'));
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt data');
    }
  }

  // Simple encryption for basic use cases
  encryptSimple(text) {
    try {
      if (!text) return null;
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', this.secretKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Combine IV and encrypted data
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      throw new Error('Failed to encrypt data');
    }
  }

  decryptSimple(encryptedText) {
    try {
      if (!encryptedText) return null;
      
      // Split IV and encrypted data
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.secretKey, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt data');
    }
  }

  // Create hash for duplicate detection without revealing the actual key
  hashApiKey(apiKey) {
    try {
      return crypto.createHash('sha256').update(apiKey).digest('hex');
    } catch (error) {
      throw new Error('Failed to hash API key');
    }
  }
}

export default new EncryptionService(); 