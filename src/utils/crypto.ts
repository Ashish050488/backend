import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '@config/index';
import { 
  TamperedDataError, 
  EncryptionError
} from '../types';
import { logger } from '@utils/logger';

const ALGORITHM = config.encryption.algorithm;
const IV_LENGTH = config.encryption.ivLength;
const AUTH_TAG_LENGTH = config.encryption.authTagLength;
const KEY_LENGTH = config.encryption.keyLength;

export class CryptoService {
  private masterKey: Buffer;

  constructor() {
    this.masterKey = Buffer.from(config.encryption.key, 'hex');
    
    if (this.masterKey.length !== KEY_LENGTH) {
      throw new EncryptionError(
        `Invalid key length: ${this.masterKey.length} bytes. Expected ${KEY_LENGTH} bytes.`
      );
    }
  }

  encrypt(plaintext: string): string {
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
      let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
      ciphertext += cipher.final('hex');
      const authTag = cipher.getAuthTag();
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

  decrypt(encryptedData: string): string {
    try {
      const parts = encryptedData.split(':');
      
      if (parts.length !== 3) {
        throw new EncryptionError(
          'Invalid encrypted data format. Expected: iv:authTag:ciphertext'
        );
      }

      const [ivHex, authTagHex, ciphertext] = parts;

      if (!this.isValidHex(ivHex) || !this.isValidHex(authTagHex) || !this.isValidHex(ciphertext)) {
        throw new EncryptionError('Invalid hex encoding in encrypted data');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      if (iv.length !== IV_LENGTH) {
        throw new EncryptionError(
          `Invalid IV length: ${iv.length} bytes. Expected ${IV_LENGTH} bytes.`
        );
      }

      if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new EncryptionError(
          `Invalid auth tag length: ${authTag.length} bytes. Expected ${AUTH_TAG_LENGTH} bytes.`
        );
      }

      const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(authTag);

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

  generateToken(length: number = 32): string {
    return randomBytes(length).toString('hex');
  }

  generatePassword(length: number = 16): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    const bytes = randomBytes(length);
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += charset[bytes[i] % charset.length];
    }
    
    return password;
  }

  private isValidHex(str: string): boolean {
    return /^[a-f0-9]*$/i.test(str);
  }
}

export const cryptoService = new CryptoService();

export function encrypt(plaintext: string): string {
  return cryptoService.encrypt(plaintext);
}

export function decrypt(encryptedData: string): string {
  return cryptoService.decrypt(encryptedData);
}

export function generateToken(length?: number): string {
  return cryptoService.generateToken(length);
}

export function generatePassword(length?: number): string {
  return cryptoService.generatePassword(length);
}

export default cryptoService;