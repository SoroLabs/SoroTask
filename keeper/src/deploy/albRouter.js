'use strict';

/**
 * Shifts blue/green traffic by rewriting the weighted `forward` default
 * action of the keeper ALB listener provisioned in terraform/services.tf.
 * It shells out to the AWS CLI (preinstalled on GitHub runners), so no new
 * npm dependency is needed. Arguments are passed as an argv array (no shell).
 */

const { execFile } = require('child_process');

class AwsAlbWeightedRouter {
  /**
   * @param {object} options
   * @param {string} options.listenerArn
   * @param {Object<string,string>} options.targetGroupArns color -> target group ARN
   * @param {string} [options.region]
   * @param {number} [options.stickinessSeconds] 0 disables stickiness
   * @param {Function} [options.exec] injectable execFile (tests)
   */
  constructor({ listenerArn, targetGroupArns, region, stickinessSeconds = 0, exec } = {}) {
    if (!listenerArn) throw new Error('listenerArn is required');
    if (!targetGroupArns || Object.keys(targetGroupArns).length < 2) {
      throw new Error('targetGroupArns must map both colors to target group ARNs');
    }
    this.listenerArn = listenerArn;
    this.targetGroupArns = targetGroupArns;
    this.region = region;
    this.stickinessSeconds = stickinessSeconds;
    this.exec = exec || execFile;
  }

  buildDefaultActions(weights) {
    const targetGroups = Object.entries(weights).map(([color, weight]) => {
      const arn = this.targetGroupArns[color];
      if (!arn) throw new Error(`no target group configured for color "${color}"`);
      return { TargetGroupArn: arn, Weight: weight };
    });
    const forwardConfig = { TargetGroups: targetGroups };
    if (this.stickinessSeconds > 0) {
      forwardConfig.TargetGroupStickinessConfig = {
        Enabled: true,
        DurationSeconds: this.stickinessSeconds,
      };
    }
    return [{ Type: 'forward', ForwardConfig: forwardConfig }];
  }

  setWeights(weights) {
    const args = [
      'elbv2',
      'modify-listener',
      '--listener-arn',
      this.listenerArn,
      '--default-actions',
      JSON.stringify(this.buildDefaultActions(weights)),
      '--output',
      'json',
    ];
    if (this.region) args.push('--region', this.region);
    return new Promise((resolve, reject) => {
      this.exec('aws', args, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`aws elbv2 modify-listener failed: ${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}

module.exports = { AwsAlbWeightedRouter };
