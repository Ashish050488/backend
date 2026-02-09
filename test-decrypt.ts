import { cryptoService } from './src/utils/crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const encryptedKey = "5dece44e960ce17d0147c773:61fad2469ed236bc6ab41adae768e7e5:397ba229a553ebc32287636434d691fe0d0d9b7d9638be92770e4f66b18490fa22c707782fdd9f";

try {
  const decrypted = cryptoService.decrypt(encryptedKey);
  console.log('Decryption successful!');
  console.log('Decrypted key:', decrypted);
  console.log('Key length:', decrypted.length);
  console.log('Starts with AIza:', decrypted.startsWith('AIza'));
} catch (error) {
  console.error('Decryption failed:', (error as Error).message);
}