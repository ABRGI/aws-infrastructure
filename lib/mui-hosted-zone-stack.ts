import * as cdk from "aws-cdk-lib";
import * as config from "config";
import { HostedZone, IHostedZone } from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";

export class MuiHostedZoneStack extends cdk.Stack {
    hostedZone: IHostedZone;
    domainCertificate: cdk.aws_certificatemanager.Certificate;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        this.hostedZone = HostedZone.fromLookup(this, "ExistingMuiHostedZone", {
            domainName: config.get('muihostedzonestack.hostedzone')
        });
        if (this.hostedZone.hostedZoneId == "DUMMY") {
            console.log('No zone found with the specified zone name. Creating new zone');
            this.hostedZone = new HostedZone(this, 'NewMuiHostedZone', { zoneName: config.get('muihostedzonestack.hostedzone') });
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
        if (config.get('muihostedzonestack.createnewsubdomaincertificate')) {
            this.domainCertificate = new Certificate(this, 'NelsonMuiDomainCertificate', {
                domainName: config.get('muihostedzonestack.domain'),
                validation: CertificateValidation.fromDns(this.hostedZone),
                certificateName: `${config.get('environmentname')}MuiDomainCertificate`
            });
            this.domainCertificate.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            //Tag certificate
            cdk.Aspects.of(this.domainCertificate).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
        }
    }
}