/**
 * State Manager Service
 * Manages deployment state transitions and validation
 */

import { Deployment } from '@models/Deployment';
import { DEPLOYMENT_STATES, VALID_STATE_TRANSITIONS, DeploymentState } from '@utils/constants';
import { StateTransitionError } from '@utils/errors';
import { logger } from '@utils/logger';
import { isValidStateTransition } from '@utils/validation';

export class StateManager {
  /**
   * Transition deployment to new state
   */
  public async transitionTo(
    deployment: InstanceType<typeof Deployment>,
    newState: DeploymentState,
    options?: {
      errorMessage?: string;
      provisioningStep?: string;
    }
  ): Promise<void> {
    const currentState = deployment.status as DeploymentState;
    const deploymentId = deployment._id.toString();

    // Validate transition
    if (!this.isValidTransition(currentState, newState)) {
      // Allow transitions to error and idle states as escape hatches
      if (newState !== DEPLOYMENT_STATES.ERROR && newState !== DEPLOYMENT_STATES.IDLE) {
        throw new StateTransitionError(currentState, newState);
      }
    }

    logger.info('State transition', {
      deploymentId,
      from: currentState,
      to: newState,
      provisioningStep: options?.provisioningStep,
    });

    // Update state
    deployment.status = newState;

    // Update optional fields
    if (options?.errorMessage) {
      deployment.errorMessage = options.errorMessage;
    }

    if (options?.provisioningStep !== undefined) {
      deployment.provisioningStep = options.provisioningStep;
    }

    // Clear error message when reaching healthy state
    if (newState === DEPLOYMENT_STATES.HEALTHY) {
      deployment.errorMessage = undefined;
      deployment.lastHeartbeat = new Date();
    }

    // Save changes
    await deployment.save();

    logger.debug('State transition completed', {
      deploymentId,
      newState,
    });
  }

  /**
   * Check if state transition is valid
   */
  public isValidTransition(currentState: DeploymentState, targetState: DeploymentState): boolean {
    return isValidStateTransition(currentState, targetState, VALID_STATE_TRANSITIONS);
  }

  /**
   * Get valid next states for current state
   */
  public getValidNextStates(currentState: DeploymentState): DeploymentState[] {
    return VALID_STATE_TRANSITIONS[currentState] || [];
  }

  /**
   * Check if deployment is in a terminal state
   */
  public isTerminalState(state: DeploymentState): boolean {
    return state === DEPLOYMENT_STATES.ERROR || state === DEPLOYMENT_STATES.STOPPED;
  }

  /**
   * Check if deployment is in a running state
   */
  public isRunningState(state: DeploymentState): boolean {
    const runningStates: DeploymentState[] = [
      DEPLOYMENT_STATES.HEALTHY,
      DEPLOYMENT_STATES.STARTING,
      DEPLOYMENT_STATES.PROVISIONING,
    ];
    return runningStates.includes(state);
  }

  /**
   * Check if deployment can be started
   */
  public canStart(state: DeploymentState): boolean {
    const startableStates: DeploymentState[] = [
      DEPLOYMENT_STATES.IDLE,
      DEPLOYMENT_STATES.STOPPED,
      DEPLOYMENT_STATES.ERROR,
    ];
    return startableStates.includes(state);
  }

  /**
   * Check if deployment can be stopped
   */
  public canStop(state: DeploymentState): boolean {
    const stoppableStates: DeploymentState[] = [
      DEPLOYMENT_STATES.HEALTHY,
      DEPLOYMENT_STATES.STARTING,
    ];
    return stoppableStates.includes(state);
  }

  /**
   * Check if deployment can be restarted
   */
  public canRestart(state: DeploymentState): boolean {
    return state === DEPLOYMENT_STATES.HEALTHY;
  }

  /**
   * Update deployment heartbeat
   */
  public async updateHeartbeat(deployment: InstanceType<typeof Deployment>): Promise<void> {
    deployment.lastHeartbeat = new Date();
    await deployment.save();
  }

  /**
   * Mark deployment as errored
   */
  public async markAsError(
    deployment: InstanceType<typeof Deployment>,
    errorMessage: string
  ): Promise<void> {
    await this.transitionTo(deployment, DEPLOYMENT_STATES.ERROR, { errorMessage });
  }

  /**
   * Clear deployment error
   */
  public async clearError(deployment: InstanceType<typeof Deployment>): Promise<void> {
    deployment.errorMessage = undefined;
    await deployment.save();
  }

  /**
   * Update provisioning step
   */
  public async updateProvisioningStep(
    deployment: InstanceType<typeof Deployment>,
    step: string
  ): Promise<void> {
    deployment.provisioningStep = step;
    await deployment.save();
    
    logger.debug('Provisioning step updated', {
      deploymentId: deployment._id.toString(),
      step,
    });
  }
}

export const stateManager = new StateManager();
export default stateManager;