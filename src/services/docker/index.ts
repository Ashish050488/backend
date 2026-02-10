/**
 * Docker Services Module
 * Main export for all Docker-related services
 */

export { dockerClient, DockerClient } from './DockerClient';
export { configBuilder, ConfigBuilder } from './ConfigBuilder';
export { healthChecker, HealthChecker } from './HealthChecker';
export { imageManager, ImageManager } from './ImageManager';
export { containerManager, ContainerManager } from './ContainerManager';

// Re-export for convenience
import { dockerClient } from './DockerClient';
import { configBuilder } from './ConfigBuilder';
import { healthChecker } from './HealthChecker';
import { imageManager } from './ImageManager';
import { containerManager } from './ContainerManager';

export default {
  client: dockerClient,
  config: configBuilder,
  health: healthChecker,
  images: imageManager,
  containers: containerManager,
};