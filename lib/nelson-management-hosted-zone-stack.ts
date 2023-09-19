/*
    This stack is used to create a hosted zone for the domain in route 53.

    Dependency:
    - Expects that the domain is already registered in Route53 or that the certificates are added for external domains
*/

import * as cdk from 'aws-cdk-lib';
import { HostedZone, IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import * as config from 'config';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';

export class NelsonManagementHostedZoneStack extends cdk.Stack {
    hostedZone: IHostedZone;
    domainCertificate: cdk.aws_certificatemanager.Certificate;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        this.hostedZone = HostedZone.fromLookup(this, "ExistingNelsonManagementHostedZone", {
            domainName: config.get('hostedzonestack.hostedzone')
        });
        if (this.hostedZone.hostedZoneId == "DUMMY") {
            console.log('No zone found with the specified zone name. Creating new zone');
            this.hostedZone = new HostedZone(this, 'NewNelsonManagementHostedZone', { zoneName: config.get('hostedzonestack.hostedzone') });
            this.hostedZone.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            //Tag resources
            cdk.Aspects.of(this.hostedZone).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(this.hostedZone).add(
                new cdk.Tag('nelson:role', `route53-hosted-zone`)
            );
            cdk.Aspects.of(this.hostedZone).add(
                new cdk.Tag('nelson:env', `prod-saas`)
            );
        }
        else {
            console.log(`Found existing zone: ${this.hostedZone.hostedZoneArn}`);
        }
        //Create a new certificate for new sub domain. Only if we need to create a new cert. If not, we will reuse existing cert
        if (config.get('hostedzonestack.createnewsubdomaincertificate')) {
            this.domainCertificate = new Certificate(this, 'NelsonManagementDomainCertificate', {
                domainName: config.get('domain'),
                validation: CertificateValidation.fromDns(this.hostedZone),
                certificateName: `${config.get('environmentname')}DomainCertificate`
            });
            this.domainCertificate.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            //Tag certificate
            cdk.Aspects.of(this.domainCertificate).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
        }
    }
}
