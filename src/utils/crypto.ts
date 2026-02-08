/**
 * CryptoService - AES-256-GCM Encryption Utility
 * 
 * Implements military-grade encryption for API keys and sensitive data.
 * Uses AES-256-GCM for authenticated encryption with integrity checking.
 * 
 * Format: iv_hex:auth_tag_hex:ciphertext_hex
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { config } from '@config/index';
import { 
  TamperedDataError, 
  EncryptionError,
  LogMetadata 
} from '@types/index';
import { logger } from '@utils/logger';

// ============================================================================
// Constants
// ============================================================================

const ALGORITHM = config.encryption.algorithm;
const IV_LENGTH = config.encryption.ivLength;
const AUTH_TAG_LENGTH = config.encryption.authTagLength;
const KEY_LENGTH = config.encryption.keyLength;

// ============================================================================
// CryptoService Class
// ============================================================================

export class CryptoService {
  private masterKey: Buffer;

  constructor() {
    // Convert hex string to Buffer
    this.masterKey = Buffer.from(config.encryption.key, 'hex');
    
    if (this.masterKey.length !== KEY_LENGTH) {
      throw new EncryptionError(
        `Invalid key length: ${this.masterKey.length} bytes. Expected ${KEY_LENGTH} bytes.`
      );
    }
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Encrypt a plaintext string using AES-256-GCM
   * 
   * @param plaintext - The string to encrypt
   * @returns Formatted string: iv_hex:auth_tag_hex:ciphertext_hex
   * @throws EncryptionError if encryption fails
   */
  encrypt(plaintext: string): string {
    try {
      // Generate a random 12-byte IV
      const iv = randomBytes(IV_LENGTH);

      // Create cipher
      const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);

      // Encrypt the plaintext
      let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
      ciphertext += cipher.final('hex');

      // Get the authentication tag
      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:ciphertext
      const result = `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;

      logger.debug('Data encrypted successfully', { 
        ivLength: iv.length,
        ciphertextLength: ciphertext.length 
      });

      return result;
    } catch (error) {
      logger.error('Encryption failed', { error: (error as Error).message });
      throw new EncryptionError(`Failed to encrypt data: ${(error as Error).message}`);
    }
  }

  /**
   * Decrypt an encrypted string using AES-256-GCM
   * 
   * @param encryptedData - Formatted string: iv_hex:auth_tag_hex:ciphertext_hex
   * @returns The decrypted plaintext string
   * @throws TamperedDataError if authentication tag verification fails
   * @throws EncryptionError if decryption fails
   */
  decrypt(encryptedData: string): string {
    try {
      // Parse the encrypted data
      const parts = encryptedData.split(':');
      
      if (parts.length !== 3) {
        throw new EncryptionError(
          'Invalid encrypted data format. Expected: iv:authTag:ciphertext'
        );
      }

      const [ivHex, authTagHex, ciphertext] = parts;

      // Validate hex strings
      if (!this.isValidHex(ivHex) || !this.isValidHex(authTagHex) || !this.isValidHex(ciphertext)) {
        throw new EncryptionError('Invalid hex encoding in encrypted data');
      }

      // Convert hex strings to Buffers
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      // Validate IV length
      if (iv.length !== IV_LENGTH) {
        throw new EncryptionError(
          `Invalid IV length: ${iv.length} bytes. Expected ${IV_LENGTH} bytes.`
        );
      }

      // Validate auth tag length
      if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new EncryptionError(
          `Invalid auth tag length: ${authTag.length} bytes. Expected ${AUTH_TAG_LENGTH} bytes.`
        );
      }

      // Create decipher
      const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);

      // Set the authentication tag BEFORE decryption
      decipher.setAuthTag(authTag);

      // Decrypt the ciphertext
      let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
      plaintext += decipher.final('utf8');

      logger.debug('Data decrypted successfully', {
        ivLength: iv.length,
        plaintextLength: plaintext.length
      });

      return plaintext;
    } catch (error) {
      if (error instanceof TamperedDataError || error instanceof EncryptionError) {
        throw error;
      }

      // Check for authentication failure (data tampering)
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('auth tag') || errorMessage.includes('authentication')) {
        logger.error('Authentication tag verification failed - possible data tampering', {
          error: errorMessage
        });
        throw new TamperedDataError();
      }

      logger.error('Decryption failed', { error: errorMessage });
      throw new EncryptionError(`Failed to decrypt data: ${errorMessage}`);
    }
  }

  /**
   * Encrypt multiple fields in an object
   * 
   * @param data - Object with fields to encrypt
   * @param fields - Array of field names to encrypt
   * @returns New object with specified fields encrypted
   */
  encryptFields<T extends Record<string, unknown>>(
    data: T, 
    fields: Array<keyof T>
  ): T {
    const result = { ...data };
    
    for (const field of fields) {
      const value = data[field];
      if (value !== undefined && value !== null && typeof value === 'string') {
        (result as Record<string, unknown>)[field as string] = this.encrypt(value);
      }
    }

    return result;
  }

  /**
   * Decrypt multiple fields in an object
   * 
   * @param data - Object with encrypted fields
   * @param fields - Array of field names to decrypt
   * @returns New object with specified fields decrypted
   */
  decryptFields<T extends Record<string, unknown>>(
    data: T, 
    fields: Array<keyof T>
  ): T {
    const result = { ...data };
    
    for (const field of fields) {
      const value = data[field];
      if (value !== undefined && value !== null && typeof value === 'string') {
        (result as Record<string, unknown>)[field as string] = this.decrypt(value);
      }
    }

    return result;
  }

  /**
   * Generate a secure random token
   * 
   * @param length - Length of the token in bytes (default: 32)
   * @returns Hex-encoded random string
   */
  generateToken(length: number = 32): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Generate a secure password
   * 
   * @param length - Length of the password (default: 16)
   * @returns Random password string
   */
  generatePassword(length: number = 16): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    const bytes = randomBytes(length);
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += charset[bytes[i] % charset.length];
    }
    
    return password;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Validate if a string is valid hexadecimal
   */
  private isValidHex(str: string): boolean {
    return /^[a-f0-9]*$/i.test(str);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const cryptoService = new CryptoService();

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Encrypt a single value (convenience function)
 */
export function encrypt(plaintext: string): string {
  return cryptoService.encrypt(plaintext);
}

/**
 * Decrypt a single value (convenience function)
 */
export function decrypt(encryptedData: string): string {
  return cryptoService.decrypt(encryptedData);
}

/**
 * Generate a secure token (convenience function)
 */
export function generateToken(length?: number): string {
  return cryptoService.generateToken(length);
}

/**
 * Generate a secure password (convenience function)
 */
export function generatePassword(length?: number): string {
  return cryptoService.generatePassword(length);
}

export default cryptoService;
