/**
 * Image Manager Service
 * Manages Docker images - pulling, caching, and validation
 */

import { dockerClient } from './DockerClient';
import { logger } from '@utils/logger';
import { DOCKER } from '@utils/constants';

export class ImageManager {
  private pullingImages: Set<string> = new Set();

  /**
   * Ensure image exists locally, pull if needed
   */
  public async ensureImageExists(image: string = DOCKER.AGENT_IMAGE): Promise<void> {
    // Check if already pulling
    if (this.pullingImages.has(image)) {
      logger.debug('Image pull already in progress, waiting...', { image });
      await this.waitForPull(image);
      return;
    }

    // Check if image exists locally
    const exists = await dockerClient.imageExists(image);
    
    if (exists) {
      logger.debug('Image already exists locally', { image });
      return;
    }

    // Pull the image
    await this.pullImage(image);
  }

  /**
   * Pull Docker image
   */
  private async pullImage(image: string): Promise<void> {
    this.pullingImages.add(image);
    
    try {
      logger.info('Pulling Docker image...', { image });
      await dockerClient.pullImage(image);
      logger.info('Docker image pulled successfully', { image });
    } catch (error) {
      logger.error('Failed to pull Docker image', {
        image,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      this.pullingImages.delete(image);
    }
  }

  /**
   * Wait for an in-progress image pull to complete
   */
  private async waitForPull(image: string, maxWait: number = 300000): Promise<void> {
    const startTime = Date.now();
    
    while (this.pullingImages.has(image)) {
      if (Date.now() - startTime > maxWait) {
        throw new Error(`Image pull timeout after ${maxWait}ms`);
      }
      
      await this.sleep(1000);
    }
  }

  /**
   * List all images
   */
  public async listImages(): Promise<any[]> {
    return dockerClient.listImages();
  }

  /**
   * Get image information
   */
  public async getImageInfo(image: string): Promise<any> {
    const images = await dockerClient.listImages({ filters: { reference: [image] } });
    return images.length > 0 ? images[0] : null;
  }

  /**
   * Check if image exists locally
   */
  public async imageExists(image: string): Promise<boolean> {
    return dockerClient.imageExists(image);
  }

  /**
   * Force pull image (even if exists locally)
   */
  public async forcePullImage(image: string): Promise<void> {
    await this.pullImage(image);
  }

  /**
   * Check if image is currently being pulled
   */
  public isPulling(image: string): boolean {
    return this.pullingImages.has(image);
  }

  /**
   * Get list of images currently being pulled
   */
  public getPullingImages(): string[] {
    return Array.from(this.pullingImages);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const imageManager = new ImageManager();
export default imageManager;